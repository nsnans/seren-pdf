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

import { Uint8TypedArray } from "../common/typed_array";
import { bytesToString, unreachable } from "../shared/util";
import { JpxDecoderOptions } from "./image";
import { Dict } from "./primitives";

export abstract class BaseStream {

  public pos: number = 0;

  public dict: Dict | null = null;

  public start: number = 0;

  public end: number = 0;

  public bytes: Uint8TypedArray = new Uint8Array(0);

  // 相当于是一个代理
  public str: BaseStream | null = null;

  constructor() {
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

  async getTransferableImage() {
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

  /**
   * @returns {Array | null}
   */
  abstract getBaseStreams(): Array<BaseStream> | null;

}

