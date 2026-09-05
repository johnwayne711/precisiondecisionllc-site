export const MAX_STEP_BYTES = 25 * 1024 * 1024;
export const STEP_KERNEL_TIMEOUT_MS = 120_000;

function normalizeWorkerError(error, fallback = "The STEP geometry worker failed.") {
  if (error instanceof Error) return error;
  const message = typeof error?.message === "string" && error.message.trim()
    ? error.message.trim()
    : fallback;
  const normalized = new Error(message);
  if (typeof error?.code === "string") normalized.code = error.code;
  return normalized;
}

/**
 * Owns one isolated STEP kernel worker and its in-worker B-rep. Source bytes
 * are cloned before transfer so the caller's provenance copy is never detached.
 */
export class StepKernelClient {
  #worker;
  #pending = new Map();
  #nextId = 1;
  #timeoutMs;
  #closed = false;

  constructor({
    WorkerImpl = globalThis.Worker,
    workerUrl = new URL("./step-kernel-worker.mjs", import.meta.url),
    timeoutMs = STEP_KERNEL_TIMEOUT_MS,
  } = {}) {
    if (typeof WorkerImpl !== "function") throw new Error("This browser cannot run the local STEP geometry worker.");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new RangeError("STEP worker timeout must be positive.");
    this.#timeoutMs = timeoutMs;
    this.#worker = new WorkerImpl(workerUrl, {type: "module", name: "gcode-studio-step-kernel"});
    this.#worker.addEventListener("message", (event) => this.#onMessage(event.data));
    this.#worker.addEventListener("error", (event) => {
      event.preventDefault?.();
      this.#failAll(new Error("The local STEP geometry worker stopped unexpectedly."));
      this.#terminateWorker();
    });
    this.#worker.addEventListener("messageerror", () => {
      this.#failAll(new Error("The STEP worker returned an unreadable result."));
      this.#terminateWorker();
    });
  }

  get closed() { return this.#closed; }

  async load({source, bytes}) {
    if (!(bytes instanceof Uint8Array)) throw new TypeError("STEP source bytes must be a Uint8Array.");
    if (!bytes.byteLength || bytes.byteLength > MAX_STEP_BYTES) {
      throw new RangeError(`STEP source must be between 1 byte and ${MAX_STEP_BYTES} bytes.`);
    }
    if (!source || typeof source.name !== "string" || !source.name || source.name.length > 512
      || /[\u0000-\u001f\u007f]/.test(source.name) || source.byteLength !== bytes.byteLength
      || typeof source.sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(source.sha256)) {
      throw new TypeError("STEP source provenance requires a name, exact byte length, and SHA-256.");
    }
    const transferable = bytes.slice().buffer;
    return this.#request("load", {source: {...source}, bytes: transferable}, [transferable]);
  }

  section(section) {
    if (!section || !["x", "y", "z"].includes(section.normalAxis) || !Number.isFinite(section.planeOffsetMm)) {
      return Promise.reject(new TypeError("STEP section requires an explicit principal normal axis and finite millimeter plane coordinate."));
    }
    return this.#request("section", {section: {...section}});
  }

  async release() {
    if (this.#closed) return;
    try {
      await this.#request("release", {}, [], Math.min(this.#timeoutMs, 5_000));
    } finally {
      this.terminate();
    }
  }

  terminate(reason = "STEP reference removed from memory.") {
    if (this.#closed) return;
    this.#failAll(new Error(reason));
    this.#terminateWorker();
  }

  #request(type, payload, transfer = [], timeoutMs = this.#timeoutMs) {
    if (this.#closed) return Promise.reject(new Error("The STEP geometry worker is closed."));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`STEP ${type} timed out; the local geometry worker was terminated.`));
        this.#failAll(new Error("The STEP geometry worker was terminated after a timeout."));
        this.#terminateWorker();
      }, timeoutMs);
      this.#pending.set(id, {resolve, reject, timeout});
      try {
        this.#worker.postMessage({id, type, ...payload}, transfer);
      } catch (error) {
        clearTimeout(timeout);
        this.#pending.delete(id);
        reject(normalizeWorkerError(error, `Could not send STEP ${type} request.`));
      }
    });
  }

  #onMessage(message) {
    if (!message || !Number.isSafeInteger(message.id)) return;
    const request = this.#pending.get(message.id);
    if (!request) return;
    this.#pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.ok === true) request.resolve(message.result);
    else request.reject(normalizeWorkerError(message.error, "The STEP geometry worker blocked this operation."));
  }

  #failAll(error) {
    for (const request of this.#pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    this.#pending.clear();
  }

  #terminateWorker() {
    if (this.#closed) return;
    this.#closed = true;
    this.#worker.terminate();
  }
}
