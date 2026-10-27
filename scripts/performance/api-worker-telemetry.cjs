const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
let sessionCalls = 0;
if (process.env.VALIDATION_COUNT_SESSIONS === 'true') {
  const auth = require('/app/packages/auth');
  const original = auth.verifySession;
  auth.verifySession = (...args) => {
    sessionCalls++;
    return original(...args);
  };
}
let previous = performance.now();
let loopSamples = [];
setInterval(() => {
  const now = performance.now();
  loopSamples.push([Date.now(), Math.max(0, now - previous - 10)]);
  previous = now;
}, 10).unref();
setInterval(() => {
  const frame = {
    time: Date.now(),
    rss: process.memoryUsage().rss,
    sessionCalls,
    loopSamples,
  };
  loopSamples = [];
  // 异步落盘，避免同步写 Windows bind mount 阻塞被测事件循环。
  fs.appendFile(
    process.env.VALIDATION_METRICS,
    JSON.stringify(frame) + '\n',
    error => {
      if (error)
        console.error('Validation telemetry write failed', error.message);
    }
  );
}, 1000).unref();
