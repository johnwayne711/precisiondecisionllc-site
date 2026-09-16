export function createFrameScheduler({requestFrame, cancelFrame, render}) {
  let pendingFrame = null;

  return {
    request() {
      if (pendingFrame !== null) return false;
      pendingFrame = requestFrame(() => {
        pendingFrame = null;
        render();
      });
      return true;
    },
    cancel() {
      if (pendingFrame === null) return false;
      cancelFrame(pendingFrame);
      pendingFrame = null;
      return true;
    },
    get pending() {
      return pendingFrame !== null;
    },
  };
}
