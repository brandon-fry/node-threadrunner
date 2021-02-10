# node-threadrunner

**node-threadrunner** provides a simple API to manage a group of nodejs Worker threads.
This is useful for small singular tasks that need to be moved off of the main thread,
but do not require extensive custom worker setup. **node-threadrunner** allows for initial
environment setup of each worker so that variable initialization and includes only need
to be done once per worker. Then each worker has access to this environment when the run
script is executed.

https://nodejs.org/api/worker_threads.html

## Features

- Lightweight
- Easy to use Promise based API
- Set a timeout for run tasks
- Worker environment setup
- Easily update parameters for background task

## Requirements
* node 12.x

## Install

Install via npm:

    npm install node-threadrunner

## Usage

To use node-threadrunner in a node.js application:

```js
const ThreadRunner = require('node-threadrunner');

const evalScript = `
  return workerProps.sampleCompute.doStuff(params[0], params[1]);
`;

// Note: This is optional
const workerPropsScript = `
  const SampleComputeClass = require('src/SampleComputeClass.js');
  return { sampleCompute: new SampleComputeClass() }
`;

// Construct the thread pool with desired config values and optional worker environment setup script
const threadrunner = new ThreadRunner({
  minThreadCount: 1,
  maxThreadCount: 3,
  workerPropsScript: workerPropsScript,
});

// Run a task in a background worker thread. Timeout in 1500ms.
threadrunner.run(evalScript, 1500, "sampleData1", "sampleData2")
  .then(result => console.log("success: ", result))
  .catch(error => {
    if (error.message === 'TimeoutError')
      console.log("The task did not complete in time");
    else
      console.log("An error occurred:", error);
  })
```

## Worker Threads
This module allows a user to execute concurrent run tasks on a configured number of
background threads. If the number of tasks exceeds the number of available threads,
tasks are queued via returned run promises that are fulfilled in the order that they
were created.

The worker pool can be configured with the min and max number of threads as well
as worker thread timeouts. The pool will maintain workers at the min worker count,
but will create workers to meet demand until the max worker count is reached. Once
the pool has more than the min number of workers, the pool will be polled at the set
pollingInterval and workers that have been idle for the set workerIdleTimeout or
greater will be terminated.

## ThreadRunner API

`
constructor(Object: options)
`
```
Options object:
maxThreadCount: integer  Defaults to config.js:maxThreadcount. The maximum number of workers allowed. Must be less than minThreadCount.
minThreadCount: integer  Defaults to config.js:minThreadCount. The minimum number of workers allowed. Must be more than maxThreadCount.
pollingInterval: integer  Defaults to config.js:pollingInterval. The interval in millisecondsworkers to check for expired workers.
workerIdleTimeout: integer  Defaults to config.js:workerIdleTimeout. The number of milliseconds a worker needs to be idle before expiring.
workerPropsScript: string  Script that is evaluated and stored as "workerProps" for each worker.
workerOptions: object  Options passed to each worker.
```

`
run(script: string, timeout: integer, ...params: [] | arguments)
`
```
Parameters:
script  The script to evaluate.
timeout  Optional. The number of milliseconds to wait before rejecting with 'TimeoutError'.
params  Parameters passed to the worker thread. Accessible as 'params[]' in script.

Return:
Promise   Resolves with script eval result or rejects with 'NoWorkerError', 'TimeoutError', 'EvalError', 'ExitError', or 'MessageError'.
```

`
terminate()
`
```
Return:
Promise   Resolves when all workers in the pool have exited.
```

The following ThreadRunner class properties are readable:
```
maxThreadCount
minThreadCount
pollingInterval // Given in ms
workerIdleTimeout // Given in ms
workerOptions
workerPropsScript
```

The following ThreadRunner class properties are writeable:
```
maxThreadCount
minThreadCount
pollingInterval
workerIdleTimeout
```

## Test
    npm run test

## Examples

See `test/threadRunner.test.js` for example usages of the ThreadRunner class.

## License
[MIT](LICENSE)
