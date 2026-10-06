export const PROJECT_POLL_VISIBLE_MS = 15_000;
export const PROJECT_POLL_HIDDEN_MS = 60_000;

// Polls share an in-flight request. A refresh after a mutation queues one fresh
// read, because the current response may describe the state before the change.
export function createSerializedRefresh<T>(load: () => Promise<T>) {
  let inFlight: Promise<T> | null = null;
  let trailing: Promise<T> | null = null;
  function refresh(requireFresh = true): Promise<T> {
    if (inFlight) {
      if (!requireFresh) return trailing ?? inFlight;
      if (!trailing) {
        const runNext = () => {
          trailing = null;
          return refresh(false);
        };
        trailing = inFlight.then(runNext, runNext);
      }
      return trailing;
    }
    const request = load().finally(() => {
      if (inFlight === request) inFlight = null;
    });
    inFlight = request;
    return request;
  }
  return refresh;
}

export function startAdaptiveProjectPolling(refresh: () => Promise<unknown>): () => void {
  let stopped = false;
  let running = false;
  let refreshOnReturn = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule() {
    clearTimeout(timer);
    if (!stopped) timer = setTimeout(run, document.hidden ? PROJECT_POLL_HIDDEN_MS : PROJECT_POLL_VISIBLE_MS);
  }
  async function run() {
    if (stopped) return;
    clearTimeout(timer);
    if (running) {
      refreshOnReturn = !document.hidden;
      return;
    }
    running = true;
    try {
      await refresh();
    } catch {
      // Keep polling after a temporary transport failure.
    } finally {
      running = false;
      if (stopped) return;
      if (refreshOnReturn && !document.hidden) {
        refreshOnReturn = false;
        void run();
      } else {
        refreshOnReturn = false;
        schedule();
      }
    }
  }
  function visibilityChanged() {
    if (!document.hidden) void run();
    else if (!running) schedule();
  }
  document.addEventListener("visibilitychange", visibilityChanged);
  void run();
  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", visibilityChanged);
  };
}
