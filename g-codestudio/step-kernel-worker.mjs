import {createStepKernelRuntime, StepKernelError} from "./step-kernel-runtime.mjs";

const workerScope = globalThis;
const runtime = createStepKernelRuntime();
let requestQueue = Promise.resolve();

function safeError(error) {
  if (error instanceof StepKernelError) {
    return {
      code: error.code,
      message: String(error.message).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 512),
    };
  }
  return {
    code: "STEP_KERNEL_INTERNAL",
    message: "The isolated STEP geometry worker blocked this operation.",
  };
}

async function execute(request) {
  if (!request || !Number.isSafeInteger(request.id) || request.id < 0) return;
  const {id, type} = request;
  try {
    let result;
    if (type === "load") {
      const transferredBytes = request.bytes instanceof ArrayBuffer ? new Uint8Array(request.bytes) : null;
      try {
        result = await runtime.load({source: request.source, bytes: request.bytes});
      } finally {
        transferredBytes?.fill(0);
      }
    } else if (type === "section") {
      result = await runtime.section(request.section ?? {});
    } else if (type === "release") {
      result = runtime.release();
    } else {
      throw new StepKernelError("STEP_REQUEST_UNSUPPORTED", "The STEP worker received an unsupported request type.");
    }
    workerScope.postMessage({id, ok: true, result});
  } catch (error) {
    workerScope.postMessage({id, ok: false, error: safeError(error)});
  }
}

workerScope.addEventListener("message", (event) => {
  requestQueue = requestQueue.then(() => execute(event.data), () => execute(event.data));
});
