/**
* Test file for the ThreadRunner module. Execute with 'npm run test'.
*/

const ThreadRunner = require('../dist/ThreadRunner.js');
const { poolConfig } = require('../config.js');
const assert = require("assert");

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

// Function for testing performance.
// from: https://developer.mozilla.org/en-US/docs/Tools/Performance/Scenarios/Intensive_JavaScript
function calculatePrimes(iterations, multiplier) {
  var primes = [];
  for (var i = 0; i < iterations; i++) {
    var candidate = i * (multiplier * Math.random());
    var isPrime = true;
    for (var c = 2; c <= Math.sqrt(candidate); ++c) {
      if (candidate % c === 0) {
        // not prime
        isPrime = false;
        break;
      }
    }
    if (isPrime) {
      primes.push(candidate);
    }
  }
  return primes;
}

function verifyDefaultPrivateProps(threadRunnerObj) {
  return typeof threadRunnerObj._events === "object" &&
    threadRunnerObj._pendingWorkerCount === 0 &&
    typeof threadRunnerObj._threadIdtoWorker === "object" &&
    threadRunnerObj._timeoutObj === null
}

function verifyOptions(threadRunnerObj, options) {
  console.log("threadRunnerObj: ", threadRunnerObj);
  console.log("options: ", options);
  return typeof threadRunnerObj.workerOptions === "object" &&
    threadRunnerObj.maxThreadCount === (options.maxThreadCount ? options.maxThreadCount : poolConfig.maxThreadCount) &&
    threadRunnerObj.minThreadCount === (options.minThreadCount ? options.minThreadCount : poolConfig.minThreadCount) &&
    threadRunnerObj.pollingInterval === (options.pollingInterval ? options.pollingInterval : poolConfig.pollingInterval) &&
    threadRunnerObj.workerIdleTimeout === (options.workerIdleTimeout ? options.workerIdleTimeout : poolConfig.workerIdleTimeout) &&
    threadRunnerObj.workerPropsScript === (options.workerPropsScript ? options.workerPropsScript : '')
}

const options_default = {
  maxThreadCount: poolConfig.maxThreadCount,
  minThreadCount: poolConfig.minThreadCount,
  pollingInterval: poolConfig.pollingInterval,
  workerIdleTimeout: poolConfig.workerIdleTimeout,
  workerPropsScript: '',
  workerOptions: {}
};

const options_invalid_1 = {
  maxThreadCount: 0,
  minThreadCount: 1,
  pollingInterval: 0,
  workerIdleTimeout: -1,
};

const options_invalid_2 = {
  maxThreadCount: 1,
  minThreadCount: 10,
};

const options_1 = {
  maxThreadCount: 10,
  minThreadCount: 10,
  pollingInterval: 10,
  workerIdleTimeout: 10,
  workerPropsScript: "const testProp = 'Hello World!';",
  workerOptions: { workerData: 'Hello World!' }
};

const options_2 = {
  maxThreadCount: 100,
  minThreadCount: 10,
};

// Async function container so that await will work as intended in tests.
(async () => {

  assert(ThreadRunner, "The expected module is undefined");

  //------------------------------------------------------------------------------
  // Test main thread delay
  //------------------------------------------------------------------------------
  let prevDate = Date.now();
  // Set a timer that will assert if the main thread is delayed too long
  let intervalObj = setInterval(() => {
    let delay = Date.now() - prevDate;
    if (delay > 100)
      assert.fail(`The main thread was delayed by ${delay}ms`)
    prevDate = Date.now();
  },
    0
  );

  //------------------------------------------------------------------------------
  // Test constructor
  //------------------------------------------------------------------------------
  const constructorThreadRunner = new ThreadRunner();
  assert.doesNotThrow(() => new ThreadRunner(), "Construction failed");
  assert.ok(verifyDefaultPrivateProps(new ThreadRunner()), "Construction failed: Incorrect default props");
  assert.ok(verifyOptions(new ThreadRunner({}), options_default), "Construction failed while testing param: {}");
  assert.ok(verifyOptions(new ThreadRunner(options_1), options_1), "Construction failed while testing param: options_1");
  assert.ok(verifyOptions(new ThreadRunner(options_2), options_2), "Construction failed while testing param: options_2");
  assert.ok(verifyOptions(new ThreadRunner(options_invalid_1), options_default), "Construction failed while testing param: options_invalid_1");
  assert.ok(verifyOptions(new ThreadRunner(options_invalid_2), { ...options_default, maxThreadCount: 1 }), "Construction failed while testing param: options_invalid_2");
  constructorThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test getters
  //------------------------------------------------------------------------------
  const getterThreadRunner = new ThreadRunner();
  assert.strictEqual(getterThreadRunner.maxThreadCount, options_default.maxThreadCount);
  assert.strictEqual(getterThreadRunner.minThreadCount, options_default.minThreadCount);
  assert.strictEqual(getterThreadRunner.pollingInterval, options_default.pollingInterval);
  assert.strictEqual(getterThreadRunner.workerIdleTimeout, options_default.workerIdleTimeout);
  assert.strictEqual(getterThreadRunner.workerPropsScript, options_default.workerPropsScript);
  assert.equal(typeof getterThreadRunner.workerOptions, typeof options_default.workerOptions);
  getterThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test setters
  //------------------------------------------------------------------------------
  const setterThreadRunner = new ThreadRunner();

  setterThreadRunner.maxThreadCount = 10;
  assert.strictEqual(setterThreadRunner.maxThreadCount, 10);

  setterThreadRunner.minThreadCount = 5;
  assert.strictEqual(setterThreadRunner.minThreadCount, 5);

  // Set Max to invalid value
  setterThreadRunner.maxThreadCount = 4;
  assert.strictEqual(setterThreadRunner.maxThreadCount, 10);

  // Set Min to invalid value
  setterThreadRunner.minThreadCount = 11;
  assert.strictEqual(setterThreadRunner.minThreadCount, 5);

  setterThreadRunner.pollingInterval = 1000;
  assert.strictEqual(setterThreadRunner.pollingInterval, 1000);

  // Set polling interval to invalid value
  setterThreadRunner.pollingInterval = 0;
  assert.strictEqual(setterThreadRunner.pollingInterval, 1000);

  setterThreadRunner.workerIdleTimeout = 0;
  assert.strictEqual(setterThreadRunner.workerIdleTimeout, 0);

  // Set timeout to invalid value
  setterThreadRunner.workerIdleTimeout = -1;
  assert.strictEqual(setterThreadRunner.workerIdleTimeout, 0);

  setterThreadRunner.maxThreadCount = 10;
  assert.strictEqual(setterThreadRunner.workerPropsScript, options_default.workerPropsScript);
  assert.equal(typeof setterThreadRunner.workerOptions, typeof options_default.workerOptions);

  setterThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test initial thread ready
  //------------------------------------------------------------------------------
  const minThreadRunner = new ThreadRunner({ minThreadCount: 10, maxThreadCount: 10 })
  assert.doesNotReject(new Promise((resolve, reject) => {
    minThreadRunner._events.on('workerReady', () => {
      if (minThreadRunner.getThreadCount() === 10) {
        let allReady = false;
        for (const worker of minThreadRunner._threadIdtoWorker.values()) {
          if (!worker.isReady()) {
            allReady = false;
          }
        }
        if (allReady) {
          resolve();
        }
      }
    });
  }),
    "Failed to initialize min thread count."
  );
  minThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test worker return
  //------------------------------------------------------------------------------
  const simpleThreadRunner = new ThreadRunner({ minThreadCount: 0, maxThreadCount: 1 });
  assert.strictEqual(3, await simpleThreadRunner.run('return 3'));
  assert.strictEqual('string', await simpleThreadRunner.run('return "string"'));
  assert.strictEqual(false, await simpleThreadRunner.run('return false'));
  assert.deepEqual([1, 2, 3], await simpleThreadRunner.run('return [1,2,3]'));
  simpleThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test run timeout
  //------------------------------------------------------------------------------
  const timeoutThreadRunner = new ThreadRunner();
  try {
    await Promise.race([
      timeoutThreadRunner.run('while(true){}', 50),
      new Promise((resolve, reject) => setTimeout(() => reject('fallbackTimeout'), 1000))
    ]);
  } catch (error) {
    if (error === 'fallbackTimeout') {
      assert.fail('run timeout test failed. ' + error);
    }
  }
  timeoutThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test params argument
  //------------------------------------------------------------------------------
  const paramsThreadRunner = new ThreadRunner();
  const testParams = ['first_param', 2, true, [1, 2, 3]];
  assert.deepEqual(testParams, await paramsThreadRunner.run('return params[0]', undefined, testParams));
  assert.deepEqual(testParams, await paramsThreadRunner.run('return params', undefined, ...testParams));
  assert.strictEqual(testParams[0], await paramsThreadRunner.run('return params[0]', null, testParams[0]));
  assert.strictEqual(testParams[2], await paramsThreadRunner.run('return params[2]', 500, testParams[0], testParams[1], testParams[2]));
  paramsThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test worker expiration
  //------------------------------------------------------------------------------
  const expireThreadRunner = new ThreadRunner({
    minThreadCount: 1,
    maxThreadCount: 10,
    pollingInterval: 50,
    workerIdleTimeout: 50
  });

  // Force additional worker threads to be created.
  try {
    await Promise.all([
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
      expireThreadRunner.run('console.log(`worker ${threadId} reporting`)'),
    ]);
  } catch (error) {
    await expireThreadRunner.terminate();
    assert.fail(`An expiration worker eval failed with error: ${error.message}`)
  }

  // Ensure the number of workers is over the min amount.
  assert.ok(expireThreadRunner.getThreadCount() > 1);

  // Allow time for the workers to expire and get dropped.
  await new Promise((resolve, reject) => {
    setTimeout(() => resolve(), 500);
  });

  // Ensure worker count is back to min amount.
  assert.strictEqual(1, expireThreadRunner.getThreadCount());

  await expireThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test worker props
  //------------------------------------------------------------------------------
  const { isMainThread } = require('worker_threads')
  const propsThreadRunner = new ThreadRunner({
    workerPropsScript:
      `const { isMainThread } = require('worker_threads');
    return { isMainThread: isMainThread }`
  });
  assert.strictEqual(true, isMainThread);
  assert.strictEqual(false, await propsThreadRunner.run('return workerProps.isMainThread'));
  await propsThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test main thread delay
  //------------------------------------------------------------------------------
  const intensiveThreadRunner = new ThreadRunner({
    minThreadCount: 100,
    maxThreadCount: 100,
    pollingInterval: 50,
    workerIdleTimeout: 50,
    workerPropsScript: `return { calculatePrimes: ${calculatePrimes.toString()} }`
  });

  try {
    await Promise.all([
      intensiveThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      intensiveThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      intensiveThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      intensiveThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      intensiveThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
    ]);
  } catch (error) {
    await intensiveThreadRunner.terminate();
    assert.fail(`An expiration worker eval failed with error: ${error.message}`)
  }

  await intensiveThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test worker wait
  //------------------------------------------------------------------------------
  const workerWaitThreadRunner = new ThreadRunner({
    minThreadCount: 0,
    maxThreadCount: 2,
    pollingInterval: 50,
    workerIdleTimeout: 50,
    workerPropsScript: `return { calculatePrimes: ${calculatePrimes.toString()} }`
  });

  try {
    await Promise.allSettled([
      workerWaitThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      workerWaitThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      workerWaitThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      workerWaitThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
      workerWaitThreadRunner.run('console.log(workerProps.calculatePrimes(10000, 10000))'),
    ]);
  } catch (error) {
    await workerWaitThreadRunner.terminate();
    assert.fail(`An expiration worker eval failed with error: ${error.message}`)
  }

  await workerWaitThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test worker data
  //------------------------------------------------------------------------------
  const optionsThreadRunner = new ThreadRunner({
    workerOptions: { workerData: 'Hello World!' }
  });

  assert.strictEqual('Hello World!', await optionsThreadRunner.run('return workerData;'));

  await optionsThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test worker errors - props
  //------------------------------------------------------------------------------
  const propsErrorThreadRunner = new ThreadRunner({ workerPropsScript: 'this is invalid' });

  let errorOccurred = false;
  try {
    await propsErrorThreadRunner.run('return 1;');
  } catch (error) {
    errorOccurred = true;
  }
  assert.strictEqual(errorOccurred, true);
  await propsErrorThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test worker errors - eval
  //------------------------------------------------------------------------------
  errorOccurred = false;
  const evalErrorThreadRunner = new ThreadRunner();
  try {
    await evalErrorThreadRunner.run('return this is invalid');
  } catch (error) {
    errorOccurred = true;
  }
  assert.strictEqual(errorOccurred, true);
  await evalErrorThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Test terminate
  //------------------------------------------------------------------------------
  const terminateThreadRunner = new ThreadRunner({ minThreadCount: 10, maxThreadCount: 10 });
  assert.strictEqual(1, await terminateThreadRunner.run('return 1'));

  // Terminate and ensure all threads are dropped
  await terminateThreadRunner.terminate();
  assert.strictEqual(0, await terminateThreadRunner.getThreadCount());

  // Ensure pool can be started and used again
  assert.strictEqual(1, await terminateThreadRunner.run('return 1'));
  await terminateThreadRunner.terminate();

  //------------------------------------------------------------------------------
  // Done
  //------------------------------------------------------------------------------
  clearInterval(intervalObj);
  console.log("Tests passed - everything looks OK!");

})(); // end async func
