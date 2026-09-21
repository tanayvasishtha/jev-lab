/**
 * Concurrency + RPM limiter. On 429, halve concurrency for 60s then recover.
 */
const DEFAULT_CONCURRENCY = 16;
const DEFAULT_RPM = 1000;

let configured = Number(process.env.JEV_CONCURRENCY) || DEFAULT_CONCURRENCY;
const rpm = Number(process.env.JEV_RPM) || DEFAULT_RPM;
let active = 0;
let halvedUntil = 0;
const queue = [];
const timestamps = [];

function currentConcurrency() {
  if (Date.now() < halvedUntil) return Math.max(1, Math.floor(configured / 2));
  return configured;
}

function prune(now) {
  while (timestamps.length && now - timestamps[0] > 60_000) timestamps.shift();
}

function pump() {
  const now = Date.now();
  prune(now);
  while (
    queue.length &&
    active < currentConcurrency() &&
    timestamps.length < rpm
  ) {
    const job = queue.shift();
    // Checked here, not at schedule()-time: a caller can fire thousands of
    // jobs into the queue in one synchronous tick (that's the whole point of
    // the concurrency fix), so by the time any of them has actually run and
    // could flip an abort flag, every job would already be queued. This is
    // the one place execution is genuinely staggered over real time, each
    // job only reaches here once an earlier one finishes and frees a slot,
    // so it's the only place a cap or circuit-breaker can actually bite
    // before the network call happens, instead of after it already cost
    // money.
    if (job.isAborted && job.isAborted()) {
      job.reject(new Error(job.abortMessage ? job.abortMessage() : "Aborted before dispatch"));
      continue;
    }
    active += 1;
    timestamps.push(Date.now());
    Promise.resolve()
      .then(job.fn)
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }
  if (
    queue.length &&
    (active >= currentConcurrency() || timestamps.length >= rpm)
  ) {
    const wait =
      timestamps.length >= rpm
        ? Math.max(5, 60_000 - (now - timestamps[0]) + 5)
        : 25;
    setTimeout(pump, wait);
  }
}

export function notify429() {
  halvedUntil = Date.now() + 60_000;
}

/**
 * @param {() => Promise<any>} fn
 * @param {{ isAborted?: () => boolean, abortMessage?: () => string }} [opts]
 */
export function schedule(fn, opts = {}) {
  return new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject, isAborted: opts.isAborted, abortMessage: opts.abortMessage });
    pump();
  });
}
