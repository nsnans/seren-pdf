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

import { GeneralStreamSink, StreamSink } from "../core/core_types";
import {
  AbortException,
  assert,
  MissingPDFException,
  PasswordException,
  UnexpectedResponseException,
  UnknownErrorException,
  unreachable,
} from "./util";

enum CallbackKind {
  UNKNOWN = 0,
  DATA = 1,
  ERROR = 2,
};

export enum StreamKind {
  UNKNOWN = 0,
  CANCEL = 1,
  CANCEL_COMPLETE = 2,
  CLOSE = 3,
  ENQUEUE = 4,
  ERROR = 5,
  PULL = 6,
  PULL_COMPLETE = 7,
  START_COMPLETE = 8,
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

interface StreamController<T> {
  controller: ReadableStreamController<T>;
  startCall: PromiseWithResolvers<void> | null;
  cancelCall: PromiseWithResolvers<void> | null;
  pullCall: PromiseWithResolvers<void> | null;
  isClosed: boolean;
}

interface HandlerMessage {
  action: string;
  sourceName: string;
  targetName: string;
  callbackId: number;
  stream?: StreamKind;
  streamId?: number;
  // 这个chunk不是通过sendWithStream发过来的
  // 而是通过comObj.postMessage发过来的
  chunk: unknown;
  callback?: CallbackKind;
  data?: unknown;
  desiredSize?: number;
  success?: boolean;
  reason?: unknown;
}

abstract class AbstractMessageHandler {

  protected _messageAC: AbortController | null = new AbortController();

  protected sourceName: string;

  protected targetName: string;

  protected comObj: MessagePoster;

  protected callbackId = 1;

  protected streamId = 1;

  protected streamSinks: Map<number, StreamSink<unknown>>;

  protected streamControllers: Map<number, StreamController<unknown>>;

  /** 泛型的具体参数类型，由action决定，不同的action是不同的泛型参数 */
  protected callbackCapabilities: Map<number, PromiseWithResolvers<unknown>>;

  protected actionHandler: Map<string, (...arg: any[]) => unknown>;

  constructor(sourceName: string, targetName: string, comObj: MessagePoster) {
    this.sourceName = sourceName;
    this.targetName = targetName;
    this.comObj = comObj;
    this.streamSinks = new Map();
    this.streamControllers = new Map();
    this.callbackCapabilities = new Map();
    this.actionHandler = new Map();

    comObj.addEventListener("message", this._onMessage.bind(this), {
      signal: this._messageAC!.signal,
    });
  }

  protected _onMessage({ data }: MessageEvent<HandlerMessage>) {
    if (data.targetName !== this.sourceName) {
      return;
    }
    if (data.stream) {
      this._processStreamMessage(data);
      return;
    }
    if (data.callback) {
      const callbackId = data.callbackId;
      const capability = this.callbackCapabilities.get(callbackId) ?? null;
      if (!capability) {
        throw new Error(`Cannot resolve callback ${callbackId}`);
      }
      this.callbackCapabilities.delete(callbackId);

      if (data.callback === CallbackKind.DATA) {
        capability.resolve(data.data);
      } else if (data.callback === CallbackKind.ERROR) {
        capability.reject(wrapReason(data.reason));
      } else {
        throw new Error("Unexpected callback case");
      }
      return;
    }
    const action = this.actionHandler.get(data.action);
    if (!action) {
      throw new Error(`Unknown action from worker: ${data.action}`);
    }
    if (data.callbackId) {
      const sourceName = this.sourceName;
      const targetName = data.sourceName;
      const comObj = this.comObj;
      new Promise(resolve => resolve(action(data.data))).then(result => {
        const msg = {
          sourceName,
          targetName,
          callback: CallbackKind.DATA,
          callbackId: data.callbackId,
          data: result,
        };
        comObj.postMessage(msg);
      }, reason => {
        const msg = {
          sourceName,
          targetName,
          callback: CallbackKind.ERROR,
          callbackId: data.callbackId,
          reason: wrapReason(reason),
        }
        comObj.postMessage(msg);
      });
      return;
    }
    if (data.streamId) {
      this._createStreamSink(data);
      return;
    }
    action(data.data);
  }

  protected on(actionName: string, handler: (...args: any[]) => unknown) {
    const ah = this.actionHandler;
    if (ah.has(actionName)) {
      throw new Error(`There is already an actionName called "${actionName}"`);
    }
    ah.set(actionName, handler);
  }

  /**
   * Sends a message to the comObj to invoke the action with the supplied data.
   * @param actionName - Action to call.
   * @param data - JSON data to send.
   * @param transfers - List of transfers/ArrayBuffers.
   */
  protected send(actionName: string, data: unknown, transfers?: Transferable[] | null) {
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
  protected sendWithPromise<T>(
    actionName: string,
    data: unknown,
    transfers?: Transferable[] | null
  ): Promise<T> {
    const callbackId = this.callbackId++;
    const capability = Promise.withResolvers<T>();
    this.callbackCapabilities.set(callbackId, <PromiseWithResolvers<unknown>>capability);
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
   * @param actionName - Action to call.
   * @param data - JSON data to send.
   * @param queueingStrategy - Strategy to signal backpressure based on
   *                 internal queue.
   * @param transfers - List of transfers/ArrayBuffers.
   * @returns ReadableStream to read data in chunks.
   */
  protected sendWithStream<T>(
    actionName: string,
    data: unknown, // data的类型应该和actionName起相对应的关系，不同的参数有不同的类型
    queueingStrategy?: QueuingStrategy,
    transfers?: Transferable[] | null
  ): ReadableStream<T> {

    const streamId = this.streamId++;
    const sourceName = this.sourceName;
    const targetName = this.targetName;
    const comObj = this.comObj;

    return new ReadableStream<T>({
      /**
       * controller是一个非常重要的对象，程序可以通过controller.enqueue的方式向ReadableStream中写入数据
       * controller.enqueue写完数据之后，ReadableStream.read()就会获取到相关的数据，进行处理了。
       */
      start: controller => {
        const startCapability = Promise.withResolvers<void>();
        const streamController: StreamController<T> = {
          controller, startCall: startCapability, pullCall: null, cancelCall: null, isClosed: false,
        }
        this.streamControllers.set(streamId, streamController);
        const message = {
          sourceName, targetName, action: actionName, streamId, data, desiredSize: controller.desiredSize,
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
        const pullCapability = Promise.withResolvers<void>();
        this.streamControllers.get(streamId)!.pullCall = pullCapability;
        const msg = {
          sourceName, targetName, stream: StreamKind.PULL, streamId, desiredSize: controller.desiredSize,
        };
        comObj.postMessage(msg);
        // Returning Promise will not call "pull"
        // again until current pull is resolved.
        return pullCapability.promise;
      },

      cancel: reason => {
        assert(reason instanceof Error, "cancel must have a valid reason");
        const cancelCapability = Promise.withResolvers<void>();
        const streamController = this.streamControllers.get(streamId)!
        streamController.cancelCall = cancelCapability;
        streamController.isClosed = true;
        comObj.postMessage({
          sourceName, targetName, stream: StreamKind.CANCEL, streamId, reason: wrapReason(reason),
        });
        // Return Promise to signal success or failure.
        return cancelCapability.promise;
      },

      type: "bytes"
    }, queueingStrategy);
  }

  protected _createStreamSink(data: HandlerMessage) {

    const streamId = data.streamId!;
    const sourceName = this.sourceName;
    const targetName = data.sourceName;
    const comObj = this.comObj;

    const self = this;
    const action = this.actionHandler.get(data.action)!;

    const streamSink = new GeneralStreamSink(
      this.comObj, sourceName, targetName, streamId, data.desiredSize!,
      (_id) => self.streamSinks.delete(_id)
    );

    streamSink.sinkCapability.resolve();
    streamSink.ready = streamSink.sinkCapability.promise;
    this.streamSinks.set(streamId, streamSink);

    new Promise(resolve => resolve(action(data.data, streamSink))).then(() => {
      const msg = {
        sourceName, targetName, stream: StreamKind.START_COMPLETE, streamId, success: true,
      }
      comObj.postMessage(msg);
    }, reason => {
      const msg = {
        sourceName, targetName, stream: StreamKind.START_COMPLETE, streamId, reason: wrapReason(reason),
      }
      comObj.postMessage(msg);
    });
  }

  protected _processStreamMessage(data: HandlerMessage) {

    const streamId = data.streamId!;
    const sourceName = this.sourceName;
    const targetName = data.sourceName;
    const comObj = this.comObj;

    const streamController = this.streamControllers.get(streamId)!;
    const streamSink = this.streamSinks.get(streamId);

    switch (data.stream) {
      case StreamKind.START_COMPLETE:
        if (data.success) {
          streamController!.startCall!.resolve();
        } else {
          streamController!.startCall!.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL_COMPLETE:
        if (data.success) {
          streamController!.pullCall!.resolve();
        } else {
          streamController!.pullCall!.reject(wrapReason(data.reason));
        }
        break;
      case StreamKind.PULL:
        // Ignore any pull after close is called.
        if (!streamSink) {
          const msg = {
            sourceName, targetName, stream: StreamKind.PULL_COMPLETE, streamId, success: true,
          }
          comObj.postMessage(msg);
          break;
        }
        // Pull increases the desiredSize property of sink, so when it changes
        // from negative to positive, set ready property as resolved promise.
        if (streamSink.desiredSize <= 0 && data.desiredSize! > 0) {
          streamSink.sinkCapability!.resolve();
        }
        // Reset desiredSize property of sink on every pull.
        streamSink.desiredSize = data.desiredSize!;

        new Promise(resolve => resolve(streamSink.onPull?.())).then(() => {
          const msg = {
            sourceName, targetName, stream: StreamKind.PULL_COMPLETE, streamId, success: true,
          }
          comObj.postMessage(msg);
        }, reason => {
          const msg = {
            sourceName, targetName, stream: StreamKind.PULL_COMPLETE, streamId, reason: wrapReason(reason),
          }
          comObj.postMessage(msg);
        });
        break;
      case StreamKind.ENQUEUE:
        assert(!!streamController, "enqueue should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        // 通向sendWithStream.read的关键
        streamController.controller.enqueue(<Uint8Array<ArrayBuffer>>data.chunk);
        break;
      case StreamKind.CLOSE:
        assert(!!streamController, "close should have stream controller");
        if (streamController.isClosed) {
          break;
        }
        streamController.isClosed = true;
        streamController.controller.close();
        this.deleteStreamController(streamController, streamId);
        break;
      case StreamKind.ERROR:
        assert(!!streamController, "error should have stream controller");
        streamController.controller.error(wrapReason(data.reason));
        this.deleteStreamController(streamController, streamId);
        break;
      case StreamKind.CANCEL_COMPLETE:
        if (data.success) {
          streamController!.cancelCall!.resolve();
        } else {
          streamController!.cancelCall!.reject(wrapReason(data.reason));
        }
        this.deleteStreamController(streamController!, streamId);
        break;
      case StreamKind.CANCEL:
        if (!streamSink) {
          break;
        }

        new Promise(resolve => resolve(streamSink.onCancel?.(wrapReason(data.reason)))).then(() => {
          const msg = {
            sourceName, targetName, stream: StreamKind.CANCEL_COMPLETE, streamId, success: true,
          };
          comObj.postMessage(msg);
        }, reason => {
          const msg = {
            sourceName, targetName, stream: StreamKind.CANCEL_COMPLETE, streamId, reason: wrapReason(reason),
          }
          comObj.postMessage(msg);
        });
        streamSink.sinkCapability!.reject(wrapReason(data.reason));
        streamSink.isCancelled = true;
        this.streamSinks.delete(streamId);
        break;
      default:
        throw new Error("Unexpected stream case");
    }
  }

  protected async deleteStreamController(streamController: StreamController<unknown>, streamId: number) {
    // Delete the `streamController` only when the start, pull, and cancel
    // capabilities have settled, to prevent `TypeError`s.
    await Promise.allSettled([
      streamController.startCall?.promise,
      streamController.pullCall?.promise,
      streamController.cancelCall?.promise,
    ]);
    this.streamControllers.delete(streamId);
  }

  destroy() {
    this._messageAC?.abort();
    this._messageAC = null;
  }
}

export { AbstractMessageHandler };
