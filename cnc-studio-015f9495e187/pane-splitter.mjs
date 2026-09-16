/**
 * Accessible, dependency-free split-pane controller.
 *
 * The current size is intentionally held only in this controller. Callers that
 * want persistence must opt in outside this module instead of making a pane
 * preference part of the job/session storage contract.
 */

const ORIENTATIONS = new Set(["vertical", "horizontal"]);

function finiteExtent(element, dimension) {
  const value = Number(element.getBoundingClientRect?.()[dimension]);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function configuredExtent(value, context, name, {allowInfinity = false} = {}) {
  const resolved = typeof value === "function" ? value(context) : value;
  const numeric = Number(resolved);
  if ((allowInfinity && numeric === Infinity) || (Number.isFinite(numeric) && numeric >= 0)) return numeric;
  throw new RangeError(`${name} must resolve to a non-negative number${allowInfinity ? " or Infinity" : ""}.`);
}

function ariaNumber(value) {
  return String(Math.round(value * 1000) / 1000);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function requireElement(value, name, {events = false} = {}) {
  if (!value || typeof value.getBoundingClientRect !== "function") throw new TypeError(`${name} must be an element with getBoundingClientRect().`);
  if (events && (typeof value.addEventListener !== "function" || typeof value.removeEventListener !== "function"
    || typeof value.setAttribute !== "function" || typeof value.removeAttribute !== "function")) {
    throw new TypeError(`${name} must support events and attributes.`);
  }
}

/**
 * @param {object} options
 * @returns {{getSize: Function, getBounds: Function, setSize: Function, reset: Function, refresh: Function, destroy: Function}}
 */
export function createPaneSplitter({
  container,
  separator,
  primaryPane,
  orientation = "vertical",
  direction = 1,
  minSize = 160,
  maxSize = Infinity,
  secondaryMinSize = 160,
  defaultSize,
  step = 16,
  largeStep = 64,
  applySize,
  measureSize,
  onChange = () => {},
  label = "Resize panes",
  controls,
  ResizeObserverClass = globalThis.ResizeObserver,
  windowTarget = globalThis,
} = {}) {
  requireElement(container, "container");
  requireElement(separator, "separator", {events: true});
  requireElement(primaryPane, "primaryPane");
  if (!ORIENTATIONS.has(orientation)) throw new RangeError("orientation must be 'vertical' or 'horizontal'.");
  if (direction !== 1 && direction !== -1) throw new RangeError("direction must be 1 or -1.");
  if (typeof onChange !== "function") throw new TypeError("onChange must be a function.");

  const axis = orientation === "vertical"
    ? {coordinate: "clientX", dimension: "width", decreaseKey: "ArrowLeft", increaseKey: "ArrowRight"}
    : {coordinate: "clientY", dimension: "height", decreaseKey: "ArrowUp", increaseKey: "ArrowDown"};
  const stepSize = configuredExtent(step, {}, "step");
  const largeStepSize = configuredExtent(largeStep, {}, "largeStep");
  const writeSize = applySize ?? ((size) => {
    if (!primaryPane.style) throw new TypeError("primaryPane.style or an applySize callback is required.");
    primaryPane.style.flexBasis = `${size}px`;
  });
  const readSize = measureSize ?? (() => finiteExtent(primaryPane, axis.dimension));
  if (typeof writeSize !== "function") throw new TypeError("applySize must be a function.");
  if (typeof readSize !== "function") throw new TypeError("measureSize must be a function.");

  let destroyed = false;
  let drag = null;
  let preferredSize;
  let appliedSize;
  let initialDefaultSize;
  let lastBounds = null;
  const managedAttributes = new Map();
  const originalTouchAction = separator.style?.touchAction;

  function setManagedAttribute(name, value) {
    if (!managedAttributes.has(name)) managedAttributes.set(name, separator.getAttribute?.(name) ?? null);
    separator.setAttribute(name, String(value));
  }

  function restoreAttributes() {
    for (const [name, value] of managedAttributes) {
      if (value === null) separator.removeAttribute(name);
      else separator.setAttribute(name, value);
    }
  }

  function layoutContext() {
    return {
      orientation,
      containerSize: finiteExtent(container, axis.dimension),
      separatorSize: finiteExtent(separator, axis.dimension),
    };
  }

  function resolveBounds() {
    const context = layoutContext();
    const min = configuredExtent(minSize, context, "minSize");
    const secondaryMin = configuredExtent(secondaryMinSize, {...context, min}, "secondaryMinSize");
    const configuredMax = configuredExtent(maxSize, {...context, min, secondaryMinSize: secondaryMin}, "maxSize", {allowInfinity: true});
    const availableMax = Math.max(0, context.containerSize - context.separatorSize - secondaryMin);
    // Responsive layouts should disable the splitter before their two pane minima
    // cannot fit. Keeping min <= max here makes the controller deterministic.
    const max = Math.max(min, Math.min(configuredMax, availableMax));
    return {...context, min, max, secondaryMinSize: secondaryMin};
  }

  function updateAria(bounds) {
    setManagedAttribute("aria-valuemin", ariaNumber(bounds.min));
    setManagedAttribute("aria-valuemax", ariaNumber(bounds.max));
    setManagedAttribute("aria-valuenow", ariaNumber(appliedSize));
    setManagedAttribute("aria-valuetext", `${ariaNumber(appliedSize)} pixels`);
  }

  function changedBounds(bounds) {
    return !lastBounds || bounds.min !== lastBounds.min || bounds.max !== lastBounds.max
      || bounds.containerSize !== lastBounds.containerSize || bounds.separatorSize !== lastBounds.separatorSize;
  }

  function synchronize(source, requested, updatePreferred = false) {
    if (destroyed) return snapshot();
    if (updatePreferred) {
      const numeric = Number(requested);
      if (!Number.isFinite(numeric)) throw new RangeError("Pane size must be finite.");
      preferredSize = numeric;
    }
    const bounds = resolveBounds();
    if (!Number.isFinite(preferredSize)) preferredSize = bounds.min;
    const next = clamp(preferredSize, bounds.min, bounds.max);
    const sizeChanged = next !== appliedSize;
    const boundsChanged = changedBounds(bounds);
    appliedSize = next;
    lastBounds = bounds;
    if (sizeChanged) writeSize(appliedSize, {...bounds, source});
    updateAria(bounds);
    if (sizeChanged || boundsChanged) onChange({...snapshot(), source});
    return snapshot();
  }

  function snapshot() {
    const bounds = lastBounds ?? resolveBounds();
    return {size: appliedSize, preferredSize, min: bounds.min, max: bounds.max};
  }

  function setSize(value) {
    return synchronize("api", value, true);
  }

  function reset(source = "reset") {
    const bounds = resolveBounds();
    const target = defaultSize === undefined
      ? initialDefaultSize
      : configuredExtent(defaultSize, bounds, "defaultSize");
    return synchronize(source, target, true);
  }

  function refresh() {
    return synchronize("resize");
  }

  function pointerDown(event) {
    if (drag || event.isPrimary === false || (event.pointerType !== "touch" && event.button !== 0)) return;
    const coordinate = Number(event[axis.coordinate]);
    if (!Number.isFinite(coordinate)) return;
    event.preventDefault?.();
    separator.focus?.({preventScroll: true});
    drag = {pointerId: event.pointerId, coordinate, size: appliedSize};
    if (separator.dataset) separator.dataset.dragging = "true";
    separator.setPointerCapture?.(event.pointerId);
  }

  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const coordinate = Number(event[axis.coordinate]);
    if (!Number.isFinite(coordinate)) return;
    event.preventDefault?.();
    synchronize("pointer", drag.size + ((coordinate - drag.coordinate) * direction), true);
  }

  function finishPointer(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const pointerId = drag.pointerId;
    drag = null;
    if (separator.dataset) delete separator.dataset.dragging;
    if (event.type !== "lostpointercapture" && separator.hasPointerCapture?.(pointerId)) separator.releasePointerCapture?.(pointerId);
  }

  function keyDown(event) {
    let target = null;
    const increment = event.shiftKey ? largeStepSize : stepSize;
    if (event.key === axis.decreaseKey) target = appliedSize - (increment * direction);
    else if (event.key === axis.increaseKey) target = appliedSize + (increment * direction);
    else if (event.key === "Home") target = resolveBounds().min;
    else if (event.key === "End") target = resolveBounds().max;
    if (target === null) return;
    event.preventDefault?.();
    synchronize("keyboard", target, true);
  }

  function doubleClick(event) {
    if (event.button !== undefined && event.button !== 0) return;
    event.preventDefault?.();
    reset("reset");
  }

  const listeners = {
    pointerdown: pointerDown,
    pointermove: pointerMove,
    pointerup: finishPointer,
    pointercancel: finishPointer,
    lostpointercapture: finishPointer,
    keydown: keyDown,
    dblclick: doubleClick,
  };

  setManagedAttribute("role", "separator");
  setManagedAttribute("tabindex", "0");
  setManagedAttribute("aria-orientation", orientation);
  if (label) setManagedAttribute("aria-label", label);
  const controlledIds = Array.isArray(controls) ? controls.filter(Boolean).join(" ") : controls;
  if (controlledIds) setManagedAttribute("aria-controls", controlledIds);
  if (separator.style) separator.style.touchAction = "none";
  for (const [type, listener] of Object.entries(listeners)) separator.addEventListener(type, listener);

  const initialBounds = resolveBounds();
  const measured = Number(readSize());
  const initial = defaultSize === undefined
    ? (Number.isFinite(measured) && measured >= 0 ? measured : initialBounds.min)
    : configuredExtent(defaultSize, initialBounds, "defaultSize");
  initialDefaultSize = initial;
  preferredSize = initial;
  synchronize("init");

  const observer = typeof ResizeObserverClass === "function" ? new ResizeObserverClass(refresh) : null;
  observer?.observe(container);
  observer?.observe(separator);
  const windowResize = observer ? null : refresh;
  if (windowResize && typeof windowTarget?.addEventListener === "function") windowTarget.addEventListener("resize", windowResize);

  return {
    getSize: () => appliedSize,
    getBounds: () => {
      const bounds = resolveBounds();
      return {min: bounds.min, max: bounds.max};
    },
    setSize,
    reset: () => reset("reset"),
    refresh,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const activePointerId = drag?.pointerId;
      drag = null;
      if (separator.dataset) delete separator.dataset.dragging;
      if (activePointerId !== undefined && separator.hasPointerCapture?.(activePointerId)) separator.releasePointerCapture?.(activePointerId);
      observer?.disconnect();
      if (windowResize && typeof windowTarget?.removeEventListener === "function") windowTarget.removeEventListener("resize", windowResize);
      for (const [type, listener] of Object.entries(listeners)) separator.removeEventListener(type, listener);
      restoreAttributes();
      if (separator.style) separator.style.touchAction = originalTouchAction ?? "";
    },
  };
}
