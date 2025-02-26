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

import { Uint8TypedArray, unreachable, JpxDecoderOptions, Dict } from "seren-common";
import { BaseStream, emptyBuffer } from "./base_stream";
import { Stream } from "./stream";

// Super class for the decoding streams.
abstract class DecodeStream extends BaseStream {

  public bufferLength: number = 0;

  protected eof: boolean = false;

  protected minBufferLength: number = 512;

  public buffer: Uint8TypedArray = emptyBuffer;

  public _rawMinBufferLength: number;

  constructor(maybeMinBufferLength: number) {
    super();
    this._rawMinBufferLength = maybeMinBufferLength || 0;

    // 初始化的设置默认值的代码 已经放到私有变量里去了
    if (maybeMinBufferLength) {
      // Compute the first power of two that is as big as maybeMinBufferLength.
      while (this.minBufferLength < maybeMinBufferLength) {
        this.minBufferLength *= 2;
      }
    }
  }

  get isEmpty(): boolean {
    while (!this.eof && this.bufferLength === 0) {
      this.readBlock(null);
    }
    return this.bufferLength === 0;
  }

  ensureBuffer(requested: number) {
    const buffer = this.buffer;
    if (requested <= buffer.byteLength) {
      return buffer;
    }
    let size = this.minBufferLength;
    while (size < requested) {
      size *= 2;
    }
    const buffer2 = new Uint8Array(size);
    buffer2.set(buffer);
    return (this.buffer = buffer2);
  }

  getByte() {
    const pos = this.pos;
    while (this.bufferLength <= pos) {
      if (this.eof) {
        return -1;
      }
      this.readBlock(null);
    }
    return this.buffer[this.pos++];
  }

  getBytes(length: number, decoderOptions: JpxDecoderOptions | null = null) {
    const pos = this.pos;
    let end;

    if (length) {
      this.ensureBuffer(pos + length);
      end = pos + length;

      while (!this.eof && this.bufferLength < end) {
        this.readBlock(decoderOptions);
      }
      const bufEnd = this.bufferLength;
      if (end > bufEnd) {
        end = bufEnd;
      }
    } else {
      while (!this.eof) {
        this.readBlock(decoderOptions);
      }
      end = this.bufferLength;
    }

    this.pos = end;
    return this.buffer.subarray(pos, end);
  }

  async getImageData(length: number, decoderOptions: JpxDecoderOptions | null = null) {
    if (!this.canAsyncDecodeImageFromBuffer) {
      return this.getBytes(length, decoderOptions);
    }
    const data = await this.stream!.asyncGetBytes();
    return this.decodeImage(data, decoderOptions);
  }

  decodeImage(
    _data: Uint8TypedArray | null,
    _decoderOptions: JpxDecoderOptions | null = null
  ): Uint8TypedArray {
    unreachable('method is not implemented');
  }

  reset() {
    this.pos = 0;
  }

  makeSubStream(start: number, length: number, dict: Dict | null = null) {
    if (length === undefined) {
      while (!this.eof) {
        this.readBlock(null);
      }
    } else {
      const end = start + length;
      while (this.bufferLength <= end && !this.eof) {
        this.readBlock(null);
      }
    }
    return new Stream(<Uint8Array<ArrayBuffer>>this.buffer, start, length, dict);
  }

  getBaseStreams() {
    return this.stream ? this.stream.getBaseStreams() : null;
  }

  get length(): number {
    throw new Error("Unsupport Mehthod get lenght()")
  }

  abstract readBlock(options: JpxDecoderOptions | null): void;
}

class StreamsSequenceStream extends DecodeStream {

  protected _onError: (reason: unknown, objId: string | null) => void;

  protected streams: BaseStream[];

  constructor(streams: unknown[], onError: (reason: unknown, objId: string | null) => void /*= null*/) {
    const baseStreams = streams.filter(s => s instanceof BaseStream);
    let maybeLength = 0;
    for (const stream of baseStreams) {
      maybeLength += stream instanceof DecodeStream ? stream._rawMinBufferLength : stream.length;
    }
    super(maybeLength);

    this.streams = baseStreams;
    this._onError = onError;
  }

  readBlock() {
    const streams = this.streams;
    if (streams.length === 0) {
      this.eof = true;
      return;
    }
    const stream = streams.shift()!;
    let chunk;
    try {
      chunk = stream.getBytes();
    } catch (reason) {
      if (this._onError) {
        this._onError(reason, stream.dict?.objId ?? null);
        return;
      }
      throw reason;
    }
    const bufferLength = this.bufferLength;
    const newLength = bufferLength + chunk.length;
    const buffer = this.ensureBuffer(newLength);
    buffer.set(chunk, bufferLength);
    this.bufferLength = newLength;
  }

  getBaseStreams() {
    const baseStreamsBuf = [];
    for (const stream of this.streams) {
      const baseStreams = stream.getBaseStreams();
      if (baseStreams) {
        baseStreamsBuf.push(...baseStreams);
      }
    }
    return baseStreamsBuf.length > 0 ? baseStreamsBuf : null;
  }
}

export { DecodeStream, StreamsSequenceStream };
