// One deadline covers every awaited read; an unresolved Promise never counts as truth.
export class AsyncProbeTimeoutError extends Error {
  constructor(timeoutMs) {
    super('Async probe did not become truthy within ' + timeoutMs + 'ms');
    this.name = 'AsyncProbeTimeoutError';
  }
}

export async function waitForTruthyProbe(probe, { timeoutMs, pollIntervalMs = 25 } = {}) {
  if (typeof probe !== 'function' || !Number.isFinite(timeoutMs) || timeoutMs <= 0 ||
      !Number.isFinite(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError('A probe, positive timeout and positive poll interval are required');
  }

  const deadline = performance.now() + timeoutMs;
  let stopped = false;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      stopped = true;
      reject(new AsyncProbeTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  const polling = (async () => {
    while (!stopped) {
      const value = await probe();
      if (stopped) return;
      const remaining = deadline - performance.now();
      if (remaining <= 0) throw new AsyncProbeTimeoutError(timeoutMs);
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, remaining)));
    }
  })();
  try {
    return await Promise.race([polling, timeout]);
  } finally {
    stopped = true;
    clearTimeout(timer);
  }
}
