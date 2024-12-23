/* Copyright 2018 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { StreamSink } from "../core/core_types";
import {
  AbortException,
  assert,
  MissingPDFException,
  PasswordException,
  UnexpectedResponseException,
  UnknownErrorException,
  unreachable,
} from "./util";

const CallbackKind = {
  UNKNOWN: 0,
  DATA: 1,
  ERROR: 2,
};

export const StreamKind = {
  UNKNOWN: 0,
  CANCEL: 1,
  CANCEL_COMPLETE: 2,
  CLOSE: 3,
  ENQUEUE: 4,
  ERROR: 5,
  PULL: 6,
  PULL_COMPLETE: 7,
  START_COMPLETE: 8,
};

export function wrapReason(reason: any) {
  const valid = !(reason instanceof Error || (typeof reason === "object" && reason !== null));
  if (valid) {
    unreachable('wrapReason: Expected "reason" to be a (possibly cloned) Error.');
  }
  switch (reason.name) {
    case "AbortException":
      return new AbortException(reason.message);
    case "MissingPDFException":
      return new MissingPDFException(reason.message);
    case "PasswordException":
      return new PasswordException(reason.message, reason.code);
    case "UnexpectedResponseException":
      return new UnexpectedResponseException(reason.message, reason.status);
    case "UnknownErrorException":
      return new UnknownErrorException(reason.message, reason.details);
    default:
      return new UnknownErrorException(reason.message, reason.toString());
  }
}

export interface MessagePoster {

  postMessage(message: any, transfer: Transferable[]): void;

  postMessage(message: any, options?: StructuredSerializeOptions): void;

  addEventListener<K extends keyof WorkerEventMap>(type: K, listener: (this: Worker, ev: WorkerEventMap[K]) => any, options?: boolean | AddEventListenerOptions): void;

}

abstract class AbstractMessageHandler {

  protected _messageAC: AbortController | null = new AbortController();

  protected sourceName: string;

  protected targetName: string;

  protected comObj: MessagePoster;

  protected callbackId = 1;

  protected streamId = 1;

  protected streamSinks: Record<string, any>;

  protected streamControllers: Record<string, any>;

  protected callbackCapabilities: Record<string, any>;

  protected actionHandler: Record<string, (...arg: any[]) => unknown>;

  constructor(sourceName: string, targetName: string, comObj: MessagePoster) {
    this.sourceName = sourceName;
    this.targetName = targetName;
    this.comObj = comObj;
    this.streamSinks = Object.create(null);
    this.streamControllers = Object.create(null);
    this.callbackCapabilities = Object.create(null);
    this.actionHandler = Object.create(null);

    comObj.addEventListener("message", this._onMessage.bind(this), {
      signal: this._messageAC!.signal,
    });
  }

  protected _onMessage({ data }: MessageEvent) {
    if (data.targetName !== this.sourceName) {
      return;
    }
    if (data.stream) {
      this._processStreamMessage(data);
      return;
    }
    if (data.callback) {
      const callbackId = data.callbackId;
      const capability = this.callbackCapabilities[callbackId];
      if (!capability) {
        throw new Error(`Cannot resolve callback ${callbackId}`);
      }
      delete this.callbackCapabilities[callbackId];

      if (data.callback === CallbackKind.DATA) {
        capability.resolve(data.data);
      } else if (data.callback === CallbackKind.ERROR) {
        capability.reject(wrapReason(data.reason));
      } else {
        throw new Error("Unexpected callback case");
      }
      return;
    }
    const action = this.actionHandler[data.action];
    if (!action) {
      throw new Error(`Unknown action from worker: ${data.action}`);
    }
    if (data.callbackId) {
      const sourceName = this.sourceName,
        targetName = data.sourceName,
        comObj = this.comObj;

      new Promise(function (resolve) {
        resolve(action(data.data));
      }).then(
        function (result) {
          comObj.postMessage({
            sourceName,
            targetName,
            callback: CallbackKind.DATA,
            callbackId: data.callbackId,
            data: result,
          });
        },
        function (reason) {
          comObj.postMessage({
            sourceName,
            targetName,
            callback: CallbackKind.ERROR,
            callbackId: data.callbackId,
            reason: wrapReason(reason),
          });
        }
      );
      return;
    }
    if (data.streamId) {
      this._createStreamSink(data);
      return;
    }
    action(data.data);
  }

  on(actionName: string, handler: (...args: any[]) => unknown) {
    const ah = this.actionHandler;
    if (ah[actionName]) {
      throw new Error(`There is already an actionName called "${actionName}"`);
    }
    ah[actionName] = handler;
  }

  /**
   * Sends a message to the comObj to invoke the action with the supplied data.
   * @param {string} actionName - Action to call.
   * @param {JSON} data - JSON data to send.
   * @param {Array} [transfers] - List of transfers/ArrayBuffers.
   */
  send(actionName: string, data: Record<string, any> | unknown | null, transfers?: Transferable[] | null) {
    const message = {
      sourceName: this.sourceName,
      targetName: this.targetName,
      action: actionName,
      data,
    };
    if (!!transfers) {
      this.comObj.postMessage(message, transfers!);
    } else {
      this.comObj.postMessage(message);
    }
  }

  /**
   * Sends a message to the comObj to invoke the action with the supplied data.
   * Expects that the other side will callback with the response.
   * @param actionName - Action to call.
   * @param data - JSON data to send.
   * @param transfers - List of transfers/ArrayBuffers.
   * @returns Promise to be resolved with response data.
   */
  sendWithPromise<T>(actionName: string, data: Record<string, any> | null, transfers?: Transferable[] | null): Promise<T> {
    const callbackId = this.callbackId++;
    const capability = Promise.withResolvers<T>();
    this.callbackCapabilities[callbackId] = capability;
    const message = {
      sourceName: this.sourceName,
      targetName: this.targetName,
      action: actionName,
      callbackId,
      data,
    };
    try {
      if (!!transfers) {
        this.comObj.postMessage(message, transfers);
      } else {
        this.comObj.postMessage(message);
      }
    } catch (ex) {
      capability.reject(ex);
    }
    return capability.promise;
  }

  /**
   * Sends a message to the comObj to invoke the action with the supplied data.
   * Expect that the other side will callback to signal 'start_complete'.
   * @param {string} actionName - Action to call.
   * @param {JSON} data - JSON data to send.
   * @param {Object} queueingStrategy - Strategy to signal backpressure based on
   *                 internal queue.
   * @param {Array} [transfers] - List of transfers/ArrayBuffers.
   * @returns {ReadableStream} ReadableStream to read data in chunks.
   */
  sendWithStream(actionName: string, data: Record<string, any> | null
    , queueingStrategy?: QueuingStrategy, transfers?: Transferable[] | null): ReadableStream<Uint8Array<ArrayBuffer>> {
    const streamId = this.streamId++,
      sourceName = this.sourceName,
      targetName = this.targetName,
      comObj = this.comObj;

    return new ReadableStream(
      {
        start: controller => {
          const startCapability = Promise.withResolvers();
          this.streamControllers[streamId] = {
            controller,
            startCall: startCapability,
            pullCall: null,
            cancelCall: null,
            isClosed: false,
          };
          const message = {
            sourceName,
            targetName,
            action: actionName,
            streamId,
            data,
            desiredSize: controller.desiredSize,
          };
          if (!!transfers) {
            comObj.postMessage(message, transfers);
          } else {
            comObj.postMessage(message);
          }
          // Return Promise for Async process, to signal success/failure.
          return startCapability.promise;
        },

        pull: controller => {
          const pullCapability = Promise.withResolvers();
          this.streamControllers[streamId].pullCall = pullCapability;
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL,
            streamId,
            desiredSize: controller.desiredSize,
          });
          // Returning Promise will not call "pull"
          // again until current pull is resolved.
          return <Promise<void>>pullCapability.promise;
        },

        cancel: reason => {
          assert(reason instanceof Error, "cancel must have a valid reason");
          const cancelCapability = Promise.withResolvers();
          this.streamControllers[streamId].cancelCall = cancelCapability;
          this.streamControllers[streamId].isClosed = true;
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.CANCEL,
            streamId,
            reason: wrapReason(reason),
          });
          // Return Promise to signal success or failure.
          return <Promise<void>>cancelCapability.promise;
        },

        type: "bytes"
      },
      queueingStrategy
    );
  }

  protected _createStreamSink(data) {
    const streamId = data.streamId,
      sourceName = this.sourceName,
      targetName = data.sourceName,
      comObj = this.comObj;
    const self = this;
    const action = this.actionHandler[data.action];

    const streamSink = new StreamSink(this.comObj, sourceName, targetName
      , streamId, data.desiredSize, (_id) => delete self.streamSinks[_id]);

    streamSink.sinkCapability.resolve(undefined);
    streamSink.ready = streamSink.sinkCapability.promise;
    this.streamSinks[streamId] = streamSink;

    new Promise(function (resolve) {
      resolve(action(data.data, streamSink));
    }).then(
      function () {
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.START_COMPLETE,
          streamId,
          success: true,
        });
      },
      function (reason) {
        comObj.postMessage({
          sourceName,
          targetName,
          stream: StreamKind.START_COMPLETE,
          streamId,
          reason: wrapReason(reason),
        });
      }
    );
  }

  protected _processStreamMessage(data) {
    const streamId = data.streamId,
      sourceName = this.sourceName,
      targetName = data.sourceName,
      comObj = this.comObj;
    const streamController = this.streamControllers[streamId],
      streamSink = this.streamSinks[streamId];

    switch (data.stream) {
      case StreamKind.START_COMPLETE:
        if (data.success) {
          streamController.startCall.resolve();
        } else {
          streamController.startCall.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL_COMPLETE:
        if (data.success) {
          streamController.pullCall.resolve();
        } else {
          streamController.pullCall.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL:
        // Ignore any pull after close is called.
        if (!streamSink) {
          comObj.postMessage({
            sourceName,
            targetName,
            stream: StreamKind.PULL_COMPLETE,
            streamId,
            success: true,
          });
          break;
        }
        // Pull increases the desiredSize property of sink, so when it changes
        // from negative to positive, set ready property as resolved promise.
        if (streamSink.desiredSize <= 0 && data.desiredSize > 0) {
          streamSink.sinkCapability.resolve();
        }
        // Reset desiredSize property of sink on every pull.
        streamSink.desiredSize = data.desiredSize;

        new Promise(function (resolve) {
          resolve(streamSink.onPull?.());
        }).then(
          function () {
            comObj.postMessage({
              sourceName,
              targetName,
              stream: StreamKind.PULL_COMPLETE,
              streamId,
              success: true,
            });
          },
          function (reason) {
            comObj.postMessage({
              sourceName,
              targetName,
              stream: StreamKind.PULL_COMPLETE,
              streamId,
              reason: wrapReason(reason),
            });
          }
        );
        break;
      case StreamKind.ENQUEUE:
        assert(streamController, "enqueue should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        streamController.controller.enqueue(data.chunk);
        break;
      case StreamKind.CLOSE:
        assert(streamController, "close should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        streamController.isClosed = true;
        streamController.controller.close();
        this.deleteStreamController(streamController, streamId);
        break;
      case StreamKind.ERROR:
        assert(streamController, "error should have stream controller");
        streamController.controller.error(wrapReason(data.reason));
        this.deleteStreamController(streamController, streamId);
        break;
      case StreamKind.CANCEL_COMPLETE:
        if (data.success) {
          streamController.cancelCall.resolve();
        } else {
          streamController.cancelCall.reject(wrapReason(data.reason));
        }
        this.deleteStreamController(streamController, streamId);
        break;
      case StreamKind.CANCEL:
        if (!streamSink) {
          break;
        }

        new Promise(function (resolve) {
          resolve(streamSink.onCancel?.(wrapReason(data.reason)));
        }).then(
          function () {
            comObj.postMessage({
              sourceName,
              targetName,
              stream: StreamKind.CANCEL_COMPLETE,
              streamId,
              success: true,
            });
          },
          function (reason) {
            comObj.postMessage({
              sourceName,
              targetName,
              stream: StreamKind.CANCEL_COMPLETE,
              streamId,
              reason: wrapReason(reason),
            });
          }
        );
        streamSink.sinkCapability.reject(wrapReason(data.reason));
        streamSink.isCancelled = true;
        delete this.streamSinks[streamId];
        break;
      default:
        throw new Error("Unexpected stream case");
    }
  }

  protected async deleteStreamController(streamController, streamId) {
    // Delete the `streamController` only when the start, pull, and cancel
    // capabilities have settled, to prevent `TypeError`s.
    await Promise.allSettled([
      streamController.startCall?.promise,
      streamController.pullCall?.promise,
      streamController.cancelCall?.promise,
    ]);
    delete this.streamControllers[streamId];
  }

  destroy() {
    this._messageAC?.abort();
    this._messageAC = null;
  }
}

export { AbstractMessageHandler };
