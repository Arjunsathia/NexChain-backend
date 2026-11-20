// Collapses repeated errors into one summary line per window, so an outage
// (database down, feed flapping) can't flood the logs with one line per tick.
const createThrottledLogger = (prefix, windowMs = 30000) => {
  let windowStart = 0;
  let suppressed = 0;

  return (message) => {
    const now = Date.now();
    if (now - windowStart >= windowMs) {
      if (suppressed > 0) {
        console.error(`${prefix} ${suppressed} more similar error(s) in the last ${Math.round(windowMs / 1000)}s`);
      }
      windowStart = now;
      suppressed = 0;
      console.error(`${prefix} ${message}`);
      return;
    }
    suppressed++;
  };
};

module.exports = createThrottledLogger;
