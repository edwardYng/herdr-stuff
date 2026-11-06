// A stand-in for the `cx` Herdr hands to init, handlers and tasks.
// spawn() runs the task at once (its awaits resolve as microtasks); flush() waits for all of them,
// including tasks spawned meanwhile. sleep() resolves at once. Timers are recorded, and tick(ms)
// fires the ones registered with that period.

export function createCx() {
  const tasks = [];
  const timers = [];
  const cx = {
    notifies: 0,
    stopped: false,
    /** @type {string[]} */
    opened: [],
    notify() {
      cx.notifies++;
    },
    stop_propagation() {
      cx.stopped = true;
    },
    open_url(url) {
      cx.opened.push(url);
    },
    sleep: async () => {},
    spawn(fn) {
      const p = Promise.resolve().then(() => fn(cx));
      tasks.push(p);
      return p;
    },
    timer: {
      every(ms, fn) {
        timers.push({ ms, fn });
      },
      after(ms, fn) {
        timers.push({ ms, fn, once: true });
      },
    },
    timers,
    async flush() {
      for (let seen = 0; seen < tasks.length;) {
        const batch = tasks.slice(seen);
        seen = tasks.length;
        await Promise.allSettled(batch);
      }
      await new Promise((r) => setTimeout(r, 0));
    },
    tick(ms) {
      for (const t of timers.filter((t) => t.ms === ms)) t.fn(cx);
    },
  };
  return cx;
}
