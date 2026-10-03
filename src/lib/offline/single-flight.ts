/**
 * Wraps an async task so a call made while one is already running is skipped, not queued.
 *
 * The flag lives in this closure rather than in React state on purpose: a callback that
 * reads `syncing` state changes identity every time the flag flips, and an effect that
 * depends on it reinstalls itself — which is how the outbox strip once synced in a loop.
 */
export function singleFlight<T>(task: () => Promise<T>): () => Promise<T | null> {
  let running = false;
  return async () => {
    if (running) return null;
    running = true;
    try {
      return await task();
    } finally {
      running = false;
    }
  };
}
