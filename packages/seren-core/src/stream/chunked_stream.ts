/* Copyright 2012 Mozilla Foundation
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

import { AbortException, MessageHandler, PDFStream, ReadResult, Uint8TypedArray } from "seren-common";
import { arrayBuffersToBytes, MissingDataException } from "../utils/core_utils";
import { BaseStream } from "./base_stream";
import { Stream } from "./stream";

export class ChunkedStream extends Stream {

  protected chunkSize: number;

  public numChunks: number;

  protected _loadedChunks = new Set();

  protected progressiveDataLength = 0;

  // Single-entry cache
  protected lastSuccessfulEnsureByteChunk = -1;

  public manager: ChunkedStreamManager;

  constructor(length: number, chunkSize: number, manager: ChunkedStreamManager) {
    super(new Uint8Array(length), 0, length, null);
    this.chunkSize = chunkSize;
    this.numChunks = Math.ceil(length / chunkSize);
    this.manager = manager;
  }

  // If a particular stream does not implement one or more of these methods,
  // an error should be thrown.
  getMissingChunks() {
    const chunks = [];
    for (let chunk = 0, n = this.numChunks; chunk < n; ++chunk) {
      if (!this._loadedChunks.has(chunk)) {
        chunks.push(chunk);
      }
    }
    return chunks;
  }

  get numChunksLoaded() {
    return this._loadedChunks.size;
  }

  get isDataLoaded() {
    return this.numChunksLoaded === this.numChunks;
  }

  onReceiveData(begin: number, chunk: Uint8Array<ArrayBuffer> | ArrayBuffer) {
    const chunkSize = this.chunkSize;
    if (begin % chunkSize !== 0) {
      throw new Error(`Bad begin offset: ${begin}`);
    }

    // Using `this.length` is inaccurate here since `this.start` can be moved
    // (see the `moveStart` method).
    const end = begin + chunk.byteLength;
    if (end % chunkSize !== 0 && end !== this.bytes.length) {
      throw new Error(`Bad end offset: ${end}`);
    }

    this.bytes.set(new Uint8Array(chunk), begin);
    const beginChunk = Math.floor(begin / chunkSize);
    const endChunk = Math.floor((end - 1) / chunkSize) + 1;

    for (let curChunk = beginChunk; curChunk < endChunk; ++curChunk) {
      // Since a value can only occur *once* in a `Set`, there's no need to
      // manually check `Set.prototype.has()` before adding the value here.
      this._loadedChunks.add(curChunk);
    }
  }

  onReceiveProgressiveData(data: Uint8Array<ArrayBuffer> | ArrayBuffer) {
    let position = this.progressiveDataLength;
    const beginChunk = Math.floor(position / this.chunkSize);

    this.bytes.set(new Uint8Array(data), position);
    position += data.byteLength;
    this.progressiveDataLength = position;
    const endChunk = position >= this.end ? this.numChunks : Math.floor(position / this.chunkSize);

    for (let curChunk = beginChunk; curChunk < endChunk; ++curChunk) {
      // Since a value can only occur *once* in a `Set`, there's no need to
      // manually check `Set.prototype.has()` before adding the value here.
      this._loadedChunks.add(curChunk);
    }
  }

  ensureByte(pos: number) {
    if (pos < this.progressiveDataLength) {
      return;
    }

    const chunk = Math.floor(pos / this.chunkSize);
    if (chunk > this.numChunks) {
      return;
    }
    if (chunk === this.lastSuccessfulEnsureByteChunk) {
      return;
    }

    if (!this._loadedChunks.has(chunk)) {
      throw new MissingDataException(pos, pos + 1);
    }
    this.lastSuccessfulEnsureByteChunk = chunk;
  }

  ensureRange(begin: number, end: number) {
    if (begin >= end) {
      return;
    }
    if (end <= this.progressiveDataLength) {
      return;
    }

    const beginChunk = Math.floor(begin / this.chunkSize);
    if (beginChunk > this.numChunks) {
      return;
    }
    const endChunk = Math.min(
      Math.floor((end - 1) / this.chunkSize) + 1,
      this.numChunks
    );
    for (let chunk = beginChunk; chunk < endChunk; ++chunk) {
      if (!this._loadedChunks.has(chunk)) {
        throw new MissingDataException(begin, end);
      }
    }
  }

  nextEmptyChunk(beginChunk: number) {
    const numChunks = this.numChunks;
    for (let i = 0; i < numChunks; ++i) {
      const chunk = (beginChunk + i) % numChunks; // Wrap around to beginning.
      if (!this._loadedChunks.has(chunk)) {
        return chunk;
      }
    }
    return null;
  }

  hasChunk(chunk: number) {
    return this._loadedChunks.has(chunk);
  }

  getByte() {
    const pos = this.pos;
    if (pos >= this.end) {
      return -1;
    }
    if (pos >= this.progressiveDataLength) {
      this.ensureByte(pos);
    }
    return this.bytes[this.pos++];
  }

  getBytes(length: number) {
    const bytes = this.bytes;
    const pos = this.pos;
    const strEnd = this.end;

    if (!length) {
      if (strEnd > this.progressiveDataLength) {
        this.ensureRange(pos, strEnd);
      }
      return bytes.subarray(pos, strEnd);
    }

    let end = pos + length;
    if (end > strEnd) {
      end = strEnd;
    }
    if (end > this.progressiveDataLength) {
      this.ensureRange(pos, end);
    }

    this.pos = end;
    return bytes.subarray(pos, end);
  }

  getByteRange(begin: number, end: number) {
    if (begin < 0) {
      begin = 0;
    }
    if (end > this.end) {
      end = this.end;
    }
    if (end > this.progressiveDataLength) {
      this.ensureRange(begin, end);
    }
    return this.bytes.subarray(begin, end);
  }

  makeSubStream(start: number, length: number | null, dict = null) {
    if (length) {
      if (start + length > this.progressiveDataLength) {
        this.ensureRange(start, start + length);
      }
    } else if (start >= this.progressiveDataLength) {
      // When the `length` is undefined you do *not*, under any circumstances,
      // want to fallback on calling `this.ensureRange(start, this.end)` since
      // that would force the *entire* PDF file to be loaded, thus completely
      // breaking the whole purpose of using streaming and/or range requests.
      //
      // However, not doing any checking here could very easily lead to wasted
      // time/resources during e.g. parsing, since `MissingDataException`s will
      // require data to be re-parsed, which we attempt to minimize by at least
      // checking that the *beginning* of the data is available here.
      this.ensureByte(start);
    }

    const subStream = new ChunkedStreamSubstream(this);
    subStream.pos = subStream.start = start;
    subStream.end = start + length! || this.end;
    subStream.dict = dict;
    return subStream;
  }

  getBaseStreams(): BaseStream[] {
    return [<BaseStream>this];
  }

  cloneState() {
    return {
      chunkSize: this.chunkSize,
      numChunks: this.numChunks,
      _loadedChunks: this._loadedChunks,
      progressiveDataLength: this.progressiveDataLength,
      lastSuccessfulEnsureByteChunk: this.lastSuccessfulEnsureByteChunk,
      manager: this.manager,
      pos: this.pos,
      dict: this.dict,
      start: this.start,
      end: this.end,
      bytes: this.bytes,
      length: this.length,
    }
  }
}

class ChunkedStreamSubstream extends ChunkedStream {

  protected _bytes: Uint8TypedArray;

  constructor(parent: ChunkedStream) {
    const state = parent.cloneState();
    // 先初始化一个空的，然后recover
    super(0, 0, state.manager);
    this.chunkSize = state.chunkSize;
    this.numChunks = state.numChunks;
    this._loadedChunks = state._loadedChunks;
    this.progressiveDataLength = state.progressiveDataLength;
    this.lastSuccessfulEnsureByteChunk = state.lastSuccessfulEnsureByteChunk;
    this.manager = state.manager;
    this.pos = state.pos;
    this.dict = state.dict;
    this.start = state.start;
    this.end = state.end;
    this._bytes = state.bytes;
  }

  get bytes() {
    return this._bytes;
  }

  get isDataLoaded() {
    if (this.numChunksLoaded === this.numChunks) {
      return true;
    }
    return this.getMissingChunks().length === 0;
  }

  getMissingChunks() {
    const chunkSize = this.chunkSize;
    const beginChunk = Math.floor(this.start / chunkSize);
    const endChunk = Math.floor((this.end - 1) / chunkSize) + 1;
    const missingChunks = [];
    for (let chunk = beginChunk; chunk < endChunk; ++chunk) {
      if (!this._loadedChunks.has(chunk)) {
        missingChunks.push(chunk);
      }
    }
    return missingChunks;
  };
}

export class ChunkedStreamManager {

  protected length: number;

  protected chunkSize: number;

  protected stream: ChunkedStream;

  protected pdfNetworkStream;

  protected disableAutoFetch: boolean;

  protected currRequestId = 0;

  protected _chunksNeededByRequest = new Map();

  protected _requestsByChunk = new Map<number, number[]>();

  protected _promisesByRequest = new Map<number, PromiseWithResolvers<void>>();

  protected progressiveDataLength = 0;

  protected aborted = false;

  protected _loadedStreamCapability = Promise.withResolvers<ChunkedStream>()

  protected msgHandler: MessageHandler;

  constructor(
    pdfNetworkStream: PDFStream,
    msgHandler: MessageHandler,
    length: number,
    disableAutoFetch: boolean,
    rangeChunkSize: number
  ) {
    this.length = length;
    this.chunkSize = rangeChunkSize;
    this.stream = new ChunkedStream(this.length, this.chunkSize, this);
    this.pdfNetworkStream = pdfNetworkStream;
    this.disableAutoFetch = disableAutoFetch;
    this.msgHandler = msgHandler;
  }

  async sendRequest(begin: number, end: number) {
    const rangeReader = this.pdfNetworkStream.getRangeReader(begin, end)!;
    if (!rangeReader.isStreamingSupported) {
      rangeReader.onProgress = this.onProgress.bind(this);
    }

    let chunks: ArrayBuffer[] | null = [], loaded = 0;
    const data = await new Promise<Uint8Array<ArrayBuffer>>((resolve, reject) => {
      const readChunk = ({ value, done }: ReadResult) => {
        try {
          if (done) {
            const chunkData = arrayBuffersToBytes(chunks!);
            chunks = null;
            resolve(chunkData);
            return;
          }

          loaded += value!.byteLength;

          if (rangeReader.isStreamingSupported) {
            this.onProgress(loaded);
          }

          chunks!.push(value!);
          rangeReader.read().then(readChunk, reject);
        } catch (e) {
          reject(e);
        }
      };
      rangeReader.read().then(readChunk, reject);
    });
    if (this.aborted) {
      return; // Ignoring any data after abort.
    }
    this.onReceiveData(data, begin);
  }

  /**
   * Get all the chunks that are not yet loaded and group them into
   * contiguous ranges to load in as few requests as possible.
   */
  requestAllChunks(noFetch = false) {
    if (!noFetch) {
      const missingChunks = this.stream.getMissingChunks();
      this._requestChunks(missingChunks);
    }
    return this._loadedStreamCapability.promise;
  }

  async _requestChunks(chunks: number[]): Promise<void> {
    const requestId = this.currRequestId++;

    const chunksNeeded = new Set<number>();
    this._chunksNeededByRequest.set(requestId, chunksNeeded);
    for (const chunk of chunks) {
      if (!this.stream.hasChunk(chunk)) {
        chunksNeeded.add(chunk);
      }
    }

    if (chunksNeeded.size === 0) {
      return Promise.resolve();
    }

    const capability = Promise.withResolvers<void>();
    this._promisesByRequest.set(requestId, capability);

    const chunksToRequest = <number[]>[];
    for (const chunk of chunksNeeded) {
      let requestIds = this._requestsByChunk.get(chunk);
      if (!requestIds) {
        requestIds = [];
        this._requestsByChunk.set(chunk, requestIds);

        chunksToRequest.push(chunk);
      }
      requestIds.push(requestId);
    }

    if (chunksToRequest.length > 0) {
      const groupedChunksToRequest = this.groupChunks(chunksToRequest);
      for (const groupedChunk of groupedChunksToRequest) {
        const begin = groupedChunk.beginChunk * this.chunkSize;
        const end = Math.min(
          groupedChunk.endChunk * this.chunkSize,
          this.length
        );
        this.sendRequest(begin, end).catch(capability.reject);
      }
    }

    return capability.promise.catch(reason => {
      if (this.aborted) {
        return; // Ignoring any pending requests after abort.
      }
      throw reason;
    });
  }

  getStream() {
    return this.stream;
  }

  /**
   * Loads any chunks in the requested range that are not yet loaded.
   */
  requestRange(begin: number, end: number) {
    end = Math.min(end, this.length);

    const beginChunk = this.getBeginChunk(begin);
    const endChunk = this.getEndChunk(end);

    const chunks = <number[]>[];
    for (let chunk = beginChunk; chunk < endChunk; ++chunk) {
      chunks.push(chunk);
    }
    return this._requestChunks(chunks);
  }

  requestRanges(ranges: { begin: number, end: number }[] = []) {
    const chunksToRequest = <number[]>[];
    for (const range of ranges) {
      const beginChunk = this.getBeginChunk(range.begin);
      const endChunk = this.getEndChunk(range.end);
      for (let chunk = beginChunk; chunk < endChunk; ++chunk) {
        if (!chunksToRequest.includes(chunk)) {
          chunksToRequest.push(chunk);
        }
      }
    }

    chunksToRequest.sort(function (a, b) {
      return a - b;
    });
    return this._requestChunks(chunksToRequest);
  }

  /**
   * Groups a sorted array of chunks into as few contiguous larger
   * chunks as possible.
   */
  groupChunks(chunks: number[]) {
    const groupedChunks = [];
    let beginChunk = -1;
    let prevChunk = -1;

    for (let i = 0, ii = chunks.length; i < ii; ++i) {
      const chunk = chunks[i];
      if (beginChunk < 0) {
        beginChunk = chunk;
      }

      if (prevChunk >= 0 && prevChunk + 1 !== chunk) {
        groupedChunks.push({ beginChunk, endChunk: prevChunk + 1 });
        beginChunk = chunk;
      }
      if (i + 1 === chunks.length) {
        groupedChunks.push({ beginChunk, endChunk: chunk + 1 });
      }

      prevChunk = chunk;
    }
    return groupedChunks;
  }

  onProgress(_loaded: number) {
    const loaded = this.stream.numChunksLoaded * this.chunkSize + _loaded;
    this.msgHandler.DocProgress(loaded, this.length);
  }

  onReceiveData(chunk: Uint8Array<ArrayBuffer> | ArrayBuffer, begin: number | null = null) {
    const isProgressive = begin === null;
    begin = isProgressive ? this.progressiveDataLength : begin;
    const end = begin! + chunk.byteLength;

    const beginChunk = Math.floor(begin! / this.chunkSize);
    const endChunk = end < this.length ? Math.floor(end / this.chunkSize) : Math.ceil(end / this.chunkSize);

    if (isProgressive) {
      this.stream.onReceiveProgressiveData(chunk);
      this.progressiveDataLength = end;
    } else {
      this.stream.onReceiveData(begin!, chunk);
    }

    if (this.stream.isDataLoaded) {
      this._loadedStreamCapability.resolve(this.stream);
    }

    const loadedRequests = [];
    for (let curChunk = beginChunk; curChunk < endChunk; ++curChunk) {
      // The server might return more chunks than requested.
      const requestIds = this._requestsByChunk.get(curChunk);
      if (!requestIds) {
        continue;
      }
      this._requestsByChunk.delete(curChunk);

      for (const requestId of requestIds) {
        const chunksNeeded = this._chunksNeededByRequest.get(requestId);
        if (chunksNeeded.has(curChunk)) {
          chunksNeeded.delete(curChunk);
        }

        if (chunksNeeded.size > 0) {
          continue;
        }
        loadedRequests.push(requestId);
      }
    }

    // If there are no pending requests, automatically fetch the next
    // unfetched chunk of the PDF file.
    if (!this.disableAutoFetch && this._requestsByChunk.size === 0) {
      let nextEmptyChunk;
      if (this.stream.numChunksLoaded === 1) {
        // This is a special optimization so that after fetching the first
        // chunk, rather than fetching the second chunk, we fetch the last
        // chunk.
        const lastChunk = this.stream.numChunks - 1;
        if (!this.stream.hasChunk(lastChunk)) {
          nextEmptyChunk = lastChunk;
        }
      } else {
        nextEmptyChunk = this.stream.nextEmptyChunk(endChunk);
      }
      if (Number.isInteger(nextEmptyChunk)) {
        this._requestChunks([nextEmptyChunk as number]);
      }
    }

    for (const requestId of loadedRequests) {
      const capability = this._promisesByRequest.get(requestId)!;
      this._promisesByRequest.delete(requestId);
      capability.resolve();
    }

    const loaded = this.stream.numChunksLoaded * this.chunkSize;
    this.msgHandler.DocProgress(loaded, this.length);
  }

  onError(err: any) {
    this._loadedStreamCapability.reject(err);
  }

  getBeginChunk(begin: number) {
    return Math.floor(begin / this.chunkSize);
  }

  getEndChunk(end: number) {
    return Math.floor((end - 1) / this.chunkSize) + 1;
  }

  abort(reason: AbortException) {
    this.aborted = true;
    this.pdfNetworkStream?.cancelAllRequests(reason);

    for (const capability of this._promisesByRequest.values()) {
      capability.reject(reason);
    }
  }
}
