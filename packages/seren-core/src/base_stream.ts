/* Copyright 2021 Mozilla Foundation
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

import { Uint8TypedArray } from "../../packages/seren-common/src/typed_array";
import { bytesToString, unreachable } from "../shared/util";
import { JpxDecoderOptions } from "./image";
import { Dict } from "./primitives";

// Lots of DecodeStreams are created whose buffers are never used.  For these
// we share a single empty buffer. This is (a) space-efficient and (b) avoids
// having special cases that would be required if we used |null| for an empty
// buffer.
export const emptyBuffer = new Uint8Array(0);
// 不要让别人试图修改这个变量
emptyBuffer.set = () => unreachable('empty buffer cannot set');

export abstract class BaseStream {

  public pos: number = 0;

  public dict: Dict | null = null;

  public start: number = 0;

  public end: number = 0;

  public stream: BaseStream | null = null;

  // 可能最后还是要写成byte getter的形式，
  get bytes(): Uint8TypedArray {
    return emptyBuffer;
  }

  abstract get length(): number;

  abstract get isEmpty(): boolean;

  get isDataLoaded() {
    return true;
  }

  abstract getByte(): number;

  abstract getBytes(_length?: number, option?: JpxDecoderOptions | null): Uint8TypedArray;

  /**
   * NOTE: This method can only be used to get image-data that is guaranteed
   *       to be fully loaded, since otherwise intermittent errors may occur;
   *       note the `ObjectLoader` class.
   */
  async getImageData(length: number, decoderOptions: JpxDecoderOptions | null) {
    return this.getBytes(length, decoderOptions);
  }

  async asyncGetBytes(): Promise<Uint8TypedArray | null> {
    unreachable("Abstract method `asyncGetBytes` called");
  }

  get isAsync() {
    return false;
  }

  get canAsyncDecodeImageFromBuffer() {
    return false;
  }

  async getTransferableImage(): Promise<VideoFrame | null> {
    return null;
  }

  peekByte() {
    const peekedByte = this.getByte();
    if (peekedByte !== -1) {
      this.pos--;
    }
    return peekedByte;
  }

  peekBytes(length?: number) {
    const bytes = this.getBytes(length);
    this.pos -= bytes.length;
    return bytes;
  }

  getUint16() {
    const b0 = this.getByte();
    const b1 = this.getByte();
    if (b0 === -1 || b1 === -1) {
      return -1;
    }
    return (b0 << 8) + b1;
  }

  getInt32() {
    const b0 = this.getByte();
    const b1 = this.getByte();
    const b2 = this.getByte();
    const b3 = this.getByte();
    return (b0 << 24) + (b1 << 16) + (b2 << 8) + b3;
  }

  getByteRange(_begin: number, _end: number) {
    unreachable("Abstract method `getByteRange` called");
  }

  getString(length?: number) {
    return bytesToString(this.getBytes(length));
  }

  skip(n?: number) {
    this.pos += n || 1;
  }

  reset() {
    unreachable("Abstract method `reset` called");
  }

  moveStart() {
    unreachable("Abstract method `moveStart` called");
  }

  abstract makeSubStream(_start: number, _length: number, _dict: Dict | null): BaseStream;

  abstract getBaseStreams(): BaseStream[] | null;

}

