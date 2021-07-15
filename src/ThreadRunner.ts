'use strict';

// Make typescript treat variables as module scope (which they already are,
// but typescript doesn't seem to obey the commonJS module scoping)
export {};

const EventEmitter = require('events');
const PoolWorker = require('./PoolWorker.js');
const { poolConfig } = require('../config.js');

interface ThreadRunnerOptions {
  maxThreadCount?: number
  minThreadCount?: number
  pollingInterval?: number
  workerIdleTimeout?: number
  workerPropsScript?: string
  workerOptions?: any
}

interface RequestQueueType {
  resolve: (worker: InstanceType<typeof PoolWorker>) => void,
  reject: (reason?: any) => void
}

module.exports =
  /**
   * This class manages a pool of workers and allows a user to execute concurrent run
   * tasks on a number of background threads. If the number of tasks exceeds the number
   * of available threads, tasks are queued via returned run promises that are fulfilled
   * in the order that they were created.
   *
   * The worker pool can be configured with the min and max number of threads as well
   * as worker thread timeouts. The pool will maintain workers at the min worker count,
   * but will create workers to meet demand until the max worker count is reached. Once
   * the pool has more than the min number of workers, the pool will be polled at the set
   * pollingInterval and workers that have been idle for the set workerIdleTimeout or
   * greater will be terminated.
   *
   * Each worker can be configured with the workerOptions object and also the workerPropsScript
   * parameter. Each worker will evaluate the workerPropsScript on thread creation and
   * store the returned value in a 'workerProps' handle that is accessible when the run
   * script is evaluated. For workerOptions parameters, see:
   * https://nodejs.org/api/worker_threads.html#worker_threads_new_worker_filename_options
   */
  class ThreadRunner {
    private readonly _events: typeof EventEmitter;
    private _pendingWorkerCount: number;
    private readonly _requestQueue: RequestQueueType[];
    private readonly _threadIdtoWorker: Map<number, InstanceType<typeof PoolWorker>>;
    private _timeoutObj: ReturnType<typeof setTimeout> | null;
    
    private _maxThreadCount: number;
    private _minThreadCount: number;
    private _pollingInterval: number;
    private _workerIdleTimeout: number;
    private _workerPropsScript: string;
    private _workerOptions: any;

    /**
     * Constructor.
     * @param {object} options  Defaults to '{}'. Config options for the worker.
     * @param {integer} options.maxThreadCount  Defaults to config.js:maxThreadcount. The maximum number of workers allowed. Must be less than minThreadCount.
     * @param {integer} options.minThreadCount   Defaults to config.js:minThreadCount. The minimum number of workers allowed. Must be more than maxThreadCount.
     * @param {integer} options.pollingInterval   Defaults to config.js:pollingInterval. The interval in millisecondsworkers to check for expired workers.
     * @param {integer} options.workerIdleTimeout   Defaults to config.js:workerIdleTimeout. The number of milliseconds a worker needs to be idle before expiring.
     * @param {string} options.workerPropsScript  Script that is evaluated and stored as "workerProps" for each worker.
     * @param {object} options.workerOptions  Options passed to each worker.
     */
    constructor(options: ThreadRunnerOptions = {}) {
      this._events = new EventEmitter();
      this._pendingWorkerCount = 0;
      this._requestQueue = [];
      this._threadIdtoWorker = new Map<number, InstanceType<typeof PoolWorker>>();
      this._timeoutObj = null;
      this._maxThreadCount = poolConfig.maxThreadCount;
      this._minThreadCount = poolConfig.minThreadCount;
      this._pollingInterval = poolConfig.pollingInterval;
      this._workerIdleTimeout = poolConfig.workerIdleTimeout;
      this._workerPropsScript = "";
      this._workerOptions = {};

      // Set these properties through the setters so that the received value can be checked.
      if (options.maxThreadCount)
        this.maxThreadCount = options.maxThreadCount;
      if (options.minThreadCount)
        this.minThreadCount = options.minThreadCount;
      if (options.pollingInterval)
        this.pollingInterval = options.pollingInterval;
      if (options.workerIdleTimeout)
        this.workerIdleTimeout = options.workerIdleTimeout;
      
      // No setters for these values. Assign directly.
      if (options.workerPropsScript)
        this._workerPropsScript = options.workerPropsScript;
      if (options.workerOptions)
        this._workerOptions = options.workerOptions;
    }

    /**
     * Get the max thread count.
     * @return {integer}
     * @public
     */
    get maxThreadCount() {
      return this._maxThreadCount;
    }

    /**
     * Get the min thread count.
     * @return {integer}
     * @public
     */
    get minThreadCount() {
      return this._minThreadCount;
    }

    /**
     * Get the worker pool polling interval.
     * @return {integer} Polling interval in milliseconds.
     * @public
     */
    get pollingInterval() {
      return this._pollingInterval;
    }

    /**
     * Get the worker idle timeout.
     * @return {integer} Worker timeout in milliseconds.
     * @public
     */
    get workerIdleTimeout() {
      return this._workerIdleTimeout;
    }

    /**
     * Get the worker options.
     * @return {object}
     * @public
     */
    get workerOptions() {
      return this._workerOptions;
    }

    /**
     * Get the worker props script.
     * @return {string}
     * @public
     */
    get workerPropsScript() {
      return this._workerPropsScript;
    }

    /**
     * Set the max thread count.
     * @param {integer} count
     * @public
     */
    set maxThreadCount(count) {
      if (count < this.minThreadCount) {
        console.error("Cannot set max thread count less than min.");
      } else if (count < 1) {
        console.error("Max thread count must be greater than 0.");
      } else {
        this._maxThreadCount = count;

        if (count > 10) {
          // Prevent warnings from the Events API.
          this._events.setMaxListeners(count);
        }
      }
    }

    /**
     * Set the min thread count.
     * @param {integer} count
     * @public
     */
    set minThreadCount(count) {
      if (count > this.maxThreadCount) {
        console.error("Cannot set min thread count greater than max.");
      } else if (count < 0) {
        console.error("Min thread count must be a positive integer.");
      } else {
        this._minThreadCount = count;
      }
    }

    /**
     * Set the polling interval.
     * @param {integer} ms  Interval in milliseconds.
     * @public
     */
    set pollingInterval(ms) {
      if (ms < 1) {
        console.error("Polling interval must be greater than or equal to one.");
      } else {
        this._pollingInterval = ms;
      }
    }

    /**
     * Get the total number of threads in the pool. Includes busy and newly created pending threads.
     * @return {integer}
     * @public
     */
    set workerIdleTimeout(ms) {
      if (ms < 0) {
        console.error("Worker timeout must be greater than zero.");
      } else {
        this._workerIdleTimeout = ms;
      }
    }

    /**
     * Get the total number of threads in the pool. Includes busy and newly created pending threads.
     * @return {integer}
     * @public
     */
    getThreadCount() {
      return this._threadIdtoWorker.size + this._pendingWorkerCount;
    }

    /**
     * Fulfills the returned promise with the result of the evaluated script. Script is
     * evaluated on a background thread.
     * @param {string} script  The script to evaluate.
     * @param {integer} timeout  Optional. The number of milliseconds to wait before rejecting with 'TimeoutError'.
     * @param {[] | arguments} params  Parameters passed to the worker thread. Accessible as 'params[]' in script.
     * @return {Promise} Resolves with script eval result or rejects with 'NoWorkerError', 'TimeoutError',
     *     'EvalError', 'ExitError', or 'MessageError'.
     * @public
     */
    async run(script: string, timeout: number, ...params: any[]) {
      if (timeout) {
        return Promise.race([
          this._waitAndReject(timeout),
          this._getWorkerAndEval(script, params)
        ]);
      } else {
        return this._getWorkerAndEval(script, params);
      }
    }

    /**
     * Terminate and drop handles to all workers. The number of workers will be 0 after
     * this is called (ignores min workers). If 'run' is called again after terminate is
     * called, min workers will be created and maintained until terminate is called again.
     * @emits 'terminate'
     * @return {Promise} Resolves when all workers in the pool have exited.
     * @public
     */
    async terminate() {
      // terminate all worker threads and clean up data.
      this._events.emit('terminate');

      while (this._requestQueue.length > 0) {
        const request = this._requestQueue.shift();
        if (request) {
          request.reject();
        }
      }

      if (this._timeoutObj) {
        clearInterval(this._timeoutObj);
        this._timeoutObj = null;
      }

      let terminateArray = Array.from(this._threadIdtoWorker, ([key, worker]) => worker.terminate());
      this._threadIdtoWorker.clear();
      return Promise.all(terminateArray);
    }

    /**
     * Removes workers in the pool that have reached the set workerIdleTimeout.
     * @param {object} self  This class instance ("this").
     * @private
     */
    _clearExpiredWorkers(self: InstanceType<typeof ThreadRunner>) {
      self._threadIdtoWorker.forEach((worker, key) => {
        if (self.getThreadCount() > self._minThreadCount &&
          worker.isReady() &&
          (Date.now() - worker.timeStamp) > self._workerIdleTimeout) {
          self._dropWorker(key);
        }
      });
    }

    /**
     * Creates workers until min worker count is reached.
     * @private
     */
    _createMinWorkers() {
      while (this.getThreadCount() < this._maxThreadCount &&
        this.getThreadCount() < this._minThreadCount) {
        // Request worker creation, but don't wait. Log error on failure, but don't
        // retry creation to prevent an infinite creation loop.
        this._createWorker()
          .catch(error => console.error("A critical error occurred while creating min workers: ", error))
      }
    }

    /**
     * Fulfills returned promise with new worker object once it is ready. Rejects promise
     * on worker error or pool termination.
     * @return {Promise} Resolves on worker ready, rejects on worker error.
     * @private
     */
    async _createWorker() {
      return new Promise((resolve, reject) => {
        ++this._pendingWorkerCount;

        const worker = new PoolWorker(this._workerPropsScript, this._workerOptions);
        const self = this;

        function errorHandler() {
          self._events.removeListener('terminate', errorHandler);
          worker.events.removeAllListeners();
          worker.terminate();
          --self._pendingWorkerCount;
          reject();
        };

        // Catch events that indicate the worker thread has stopped and clean up resources.
        this._events.once('terminate', errorHandler);
        worker.events.once('error', errorHandler);
        worker.events.once('exit', errorHandler);

        // Perform one-time worker setup.
        worker.events.once('ready', () => {
          // Add to worker container.
          this._threadIdtoWorker.set(worker.threadId, worker);
          --this._pendingWorkerCount;

          // Start expiration timer if needed.
          if (this._timeoutObj === null &&
            this._threadIdtoWorker.size > this._minThreadCount) {
            this._timeoutObj = setInterval(this._clearExpiredWorkers, this._pollingInterval, this);
          }

          // Reset all event connections.
          this._events.removeListener('terminate', errorHandler);
          worker.events.removeAllListeners();

          // Handle dead workers.
          worker.events.on('error', (threadId: number) => {
            this._dropWorker(threadId);
            this._createMinWorkers();
          });
          worker.events.on('exit', (threadId: number) => {
            this._dropWorker(threadId);
            this._createMinWorkers();
          });

          // Check for queued requests each time this worker becomes ready.
          worker.events.on('ready', (threadId: number) => {
            if (this._requestQueue.length > 0) {
              const request = this._requestQueue.shift();
              request && request.resolve(this._threadIdtoWorker.get(threadId));
            }
          });

          // This worker has just become ready, check for pending requests.
          if (this._requestQueue.length > 0) {
            const request = this._requestQueue.shift();
            request && request.resolve(worker);
          }

          resolve('Success');
        });
      });
    }

    /**
     * Terminates and drops handles to pool worker with provided thread ID.
     * @param {integer} threadId  The ID of the pool worker to drop.
     * @private
     */
    _dropWorker(threadId: number) {
      let worker = this._threadIdtoWorker.get(threadId);
      if (worker) {
        if (poolConfig.debugLogs) {
          console.debug(`Dropping worker: ${threadId}`)
        }

        worker.terminate()
          .catch((error: Error) => console.error(`An error occurred while terminating worker ${threadId}: ${error}`))

        this._threadIdtoWorker.delete(threadId);

        if (this.getThreadCount() <= this._minThreadCount &&
          this._timeoutObj) {
          // The number of workers is at the baseline. The timer is no longer needed.
          clearInterval(this._timeoutObj);
          this._timeoutObj = null;
        }
      }
    }

    /**
     * Get a ready worker to evaluate the provided script and params.
     * @note Due to the asynchronous nature of the run function, it is important that getting
     *   the ready worker and calling eval on it is done in one step.
     * @param {string} script  The script to evaluate.
     * @param {[] | arguments} params  Parameters passed to worker thread.
     * @return {Promise} Resolves with script eval result or rejects with 'NoWorkerError'.
     * @public
     */
    async _getWorkerAndEval(script: string, params: any[]) {
      return new Promise((resolve, reject) => {
        // Check for a ready worker in the pool.
        for (const worker of this._threadIdtoWorker.values()) {
          if (worker.isReady()) {
            resolve(worker.eval(script, params));
            return;
          }
        }

        // An idle worker was not found. Check if a new worker can be created.
        if (this.getThreadCount() < this._maxThreadCount) {
          // Create worker asynchronously to allow this request to still catch the next
          // ready worker after adding to the resolveWorkerQueue below.
          this._createWorker()
            .catch(error => {
              console.error(`Failed to create new worker: ${error}`)
              if (this.getThreadCount() === 0) {
                // There are no workers to handle the request.
                reject(new Error('NoWorkerError'));
              }
            })
        }

        // Add request to queue for next ready worker to handle.
        if (this.getThreadCount() > 0) {
          if (poolConfig.debugLogs) {
            console.debug("Waiting for ready worker");
          }

          this._requestQueue.push({
            resolve: (worker) => { resolve(worker.eval(script, params)) },
            reject: reject
          });
        } else {
          console.warn(`Failed to create or find an available worker.
                      Are min/max thread counts set correctly?`);
          reject(new Error('NoWorkerError'));
          return;
        }
      });
    }

    /**
     * Rejects returned promise after provided number of milliseconds.
     * @param {integer} ms  Timeout in milliseconds.
     * @return {Promise}
     * @private
     */
    _waitAndReject(ms: number) {
      return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('TimeoutError')), ms);
      });
    }
  }
