const { AsyncLocalStorage } = require("node:async_hooks");
const { performance } = require("node:perf_hooks");
const context = new AsyncLocalStorage();
const phases = new Set([
  "cache_wait",
  "queue",
  "disconnect",
  "connect",
  "reuse",
  "operation",
  "list",
  "mailbox_lock",
  "status",
  "search",
  "fetch",
  "source_fetch",
  "parse",
]);
function createTrace() {
  const stages = new Map();
  return {
    errorCode: "",
    start(phase) {
      if (!phases.has(phase)) return () => {};
      let stage = stages.get(phase);
      if (!stage) {
        stage = { durationMs: 0, count: 0, active: new Set() };
        stages.set(phase, stage);
      }
      const started = performance.now();
      const token = { started };
      stage.count++;
      stage.active.add(token);
      return () => {
        if (stage.active.delete(token))
          stage.durationMs += performance.now() - started;
      };
    },
    snapshot() {
      const now = performance.now();
      return [...stages].map(([phase, stage]) => ({
        phase,
        durationMs: Math.round(
          stage.durationMs +
            [...stage.active].reduce(
              (sum, token) => sum + now - token.started,
              0,
            ),
        ),
        count: stage.count,
        active: stage.active.size > 0,
      }));
    },
  };
}
const currentTrace = () => context.getStore();
async function measure(phase, action, trace = currentTrace()) {
  const finish = trace?.start(phase);
  try {
    return await action();
  } finally {
    finish?.();
  }
}
module.exports = {
  createTrace,
  currentTrace,
  measure,
  phases,
  runTrace: (trace, action) => context.run(trace, action),
};
