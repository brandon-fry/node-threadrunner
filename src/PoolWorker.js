'use strict';

const EventEmitter = require('events');
const {
  Worker, workerData, MessageChannel, isMainThread, parentPort, threadId
} = require('worker_threads');

const WorkerState = {
  INITIALIZING: 1,
  BUSY: 2,
  READY: 3,
  DEAD: 4,
}

//------------------------------------------------------------------------------
// Main thread execution
//------------------------------------------------------------------------------
if (isMainThread) {
  module.exports =
    /**
     * PoolWorker extends NodeJs' Worker class and provides additional functionality
     * to maintain and track the worker's status. It also provides a worker thread
     * execution implementation that allows evaluating JavaScript code on creation or
     * on demand in the thread.
     */
    class PoolWorker extends Worker {

    /**
     * Constructor.
     * @param {string} workerPropsScript  Defaults to null. Evaluated on worker thread creation and stored as 'workerProps' variable.
     * @param {object} options  Defaults to '{}'. Config options for the worker. See Docs.
     */
    constructor(workerPropsScript = null, options = {}) {
      super(__filename, options);

      this._events = new EventEmitter();
      this._pendingEvalReject = null;
      this._pendingEvalResolve = null;
      this._threadId = -1;
      this._timeStamp = Date.now();
      this._timeoutObj = null;
      this._workerState = WorkerState.INITIALIZING;

      this._implChannel = new MessageChannel();
      this._mainPort = this._implChannel.port2;
      this._mainPort.on('message', (message) => this._handleResult(message));
      this._mainPort.on('messageerror', (error) => this._handleMessageError(error));
      this._workerPort = this._implChannel.port1;

      // Send request to set up worker.
      this.postMessage(
        {
          workerPropsScript: workerPropsScript,
          workerPort: this._workerPort,
        },
        [this._workerPort]
      );

      // On worker error, the thread is terminated.
      this.on('error', (error) => this._handleError(error));

      // On worker exit, the thread is stopped.
      this.on('exit', (code) => this._handleExit(code));

      this.once('message', (msg) => {
        // Worker is now ready
        this._threadId = msg.threadId;
        this._resetReady();
      });

      // Catch unexpected worker setup issues.
      this._timeoutObj = setTimeout(
        () => {
          if (this._threadId === -1) {
            this._handleError(new Error('Worker failed to report ready.'))
          }
        },
        5000
      );
    }

    /**
     * Get the events object to listen to this worker's events:
     *     Event: 'error'
     *     Event: 'exit'
     *     Event: 'ready'
     * @return {object} The EventEmitter object.
     * @public
     */
    get events() {
      return this._events;
    }

    /**
     * Get the identifier of this worker's thread.
     * @return {integer}
     * @public
     */
    get threadId() {
      return this._threadId;
    }

    /**
     * Get the timestamp of this worker's last use. I.e. Date.now() value at time of use.
     * @return {Number} Timestamp in milliseconds.
     * @public
     */
    get timeStamp() {
      return this._timeStamp
    }

    /**
     * Evaluates script on the worker thread and fulfills the returned promise with the
     * evaluated result or rejects with 'EvalError', 'ExitError', or 'MessageError'.
     * @param {string} script  JavaScript code to be evaluated.
     * @return {Promise}
     * @public
     */
    eval(script, params) {
      this._mainPort.postMessage({ script: script, params: params }, []);
      this._workerState = WorkerState.BUSY;

      return new Promise((resolve, reject) => {
        this._pendingEvalReject = reject;
        this._pendingEvalResolve = resolve;
      });
    }

    /**
     * Get whether the worker is ready to evaluate new messages.
     * @return {boolean}
     * @public
     */
    isReady() {
      return this._workerState === WorkerState.READY;
    }

    /**
     * Stop all JavaScript execution in the worker thread.
     * @return {Promise} Returns a promise that is fulfilled with the worker's exit code.
     * @public
     */
    terminate() {
      this._mainPort.unref();
      this._events.removeAllListeners();
      clearTimeout(this._timeoutObj);
      return super.terminate();
    }

    /**
     * Handler for the worker thread's 'error' event (e.g. uncaught exception in eval).
     * Rejects the pending eval promise with 'EvalError'.
     * @param {Error} error  The error code received from the worker.
     * @private
     */
    _handleError(error) {
      this._workerState = WorkerState.DEAD;
      if (this._pendingEvalReject) {
        this._pendingEvalReject(new Error('EvalError'));
      }
      this._pendingEvalReject = null;
      this._pendingEvalResolve = null;

      if (this._events.listenerCount('error') > 0) {
        this._events.emit('error', this._threadId, error);
      }

      console.error("Worker failed with an error: ", error);
    }

    /**
     * Handler for the worker thread's 'exit' event. Rejects the pending eval promise
     * with 'ExitError'.
     * @param {integer} exitCode  The exit code received from the worker.
     * @private
     */
    _handleExit(exitCode) {
      this._workerState = WorkerState.DEAD;
      if (this._pendingEvalReject) {
        this._pendingEvalReject(new Error('ExitError'));
      }
      this._pendingEvalReject = null;
      this._pendingEvalResolve = null;

      if (this._events.listenerCount('exit') > 0) {
        this._events.emit('exit', this._threadId, exitCode);
      }

      console.debug("Worker exited with code: ", exitCode);
    }

    /**
     * Handler for the worker thread's 'messageerror' event. Rejects the pending eval
     * promise with 'MessageError'.
     * @param {Error} error  The error code received from the worker.
     * @private
     */
    _handleMessageError(error) {
      if (this._pendingEvalReject) {
        this._pendingEvalReject(new Error('MessageError'));
      }
      this._pendingEvalReject = null;
      this._pendingEvalResolve = null;
      this._resetReady();

      console.error("Worker failed with an error: ", error);
    }

    /**
     * Handler for the worker thread's 'message' event. Resolves pending eval promise
     * with result.
     * @param {any} result  The value received from the worker.
     * @private
     */
    _handleResult(result) {
      if (this._pendingEvalResolve) {
        this._pendingEvalResolve(result);
      }

      this._pendingEvalReject = null;
      this._pendingEvalResolve = null;

      this._resetReady();
    }

    /**
     * Set the worker status as ready. Emits 'ready' signal.
     * @emits 'ready'
     * @private
     */
    _resetReady() {
      this._timeStamp = Date.now();
      this._workerState = WorkerState.READY;
      this._events.emit('ready', this._threadId);

      console.debug(`Worker ${this._threadId} reporting ready`);
    }
  }
}
//------------------------------------------------------------------------------
// Worker thread execution
//------------------------------------------------------------------------------
else {
  let workerPort;
  let workerProps = {};

  parentPort.once('message', (value) => {
    // Set up worker properties if provided.
    if (value.workerPropsScript) {
      try {
        // Function is evaluated in the global scope, so pass through params that the passed script can use.
        workerProps = Function('workerData','threadId', 'exports', 'require', 'module', '__filename', '__dirname', value.workerPropsScript)(
          workerData, threadId, exports, require, module, __filename, __dirname
        );
      } catch (error) {
          console.error("Worker encountered a critical error on setup. Check workerPropsScript.");
          throw error
      }
    }

    // Grab the provided port.
    workerPort = value.workerPort;

    // Connect to requests from the main thread.
    workerPort.on('message', (value) => {
      workerPort.postMessage(
        // Function is evaluated in the global scope, so pass through params that the passed script can use.
        Function('workerProps', 'workerData', 'threadId', 'exports', 'require', 'module', '__filename', '__dirname', 'params', value.script)(
          workerProps, workerData, threadId, exports, require, module, __filename, __dirname, value.params,
        )
      );
    });

    // Setup is done, return thread id.
    parentPort.postMessage({ threadId: threadId });
  });
}
