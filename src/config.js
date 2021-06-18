module.exports.poolConfig = {
  maxThreadCount: 4,
  minThreadCount: 1,
  pollingInterval: 15000,
  workerIdleTimeout: 30000,
  debugLogs: false,
};

const origConsoleDebug = console.debug;
console.debug = function (msg) { if (module.exports.poolConfig.debugLogs) { origConsoleDebug(msg) } };
