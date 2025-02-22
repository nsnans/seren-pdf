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

import { Uint8TypedArray } from "../../packages/seren-common/src/typed_array";
import { shadow } from "../shared/util";
import { BaseStream, emptyBuffer } from "./base_stream";
import { DecodeStream } from "./decode_stream";
import { JpxDecoderOptions } from "./image";
import { JpxImage } from "./jpx";
import { Dict } from "./primitives";

/**
 * For JPEG 2000's we use a library to decode these images and
 * the stream behaves like all the other DecodeStreams.
 */
export class JpxStream extends DecodeStream {

  protected maybeLength: number;

  protected params: Dict | null;

  public stream: BaseStream;

  constructor(stream: BaseStream, maybeLength: number, params: Dict | null) {
    super(maybeLength);
    this.stream = stream;
    this.dict = stream.dict;
    this.maybeLength = maybeLength;
    this.params = params;
  }

  get bytes() {
    // If `this.maybeLength` is null, we'll get the entire stream.
    return shadow(this, "bytes", this.stream.getBytes(this.maybeLength));
  }

  ensureBuffer(_requested: number) {
    // No-op, since `this.readBlock` will always parse the entire image and
    // directly insert all of its data into `this.buffer`.
    return emptyBuffer;
  }

  readBlock(decoderOptions: JpxDecoderOptions | null) {
    this.decodeImage(null, decoderOptions);
  }

  decodeImage(bytes: Uint8TypedArray | null, decoderOptions: JpxDecoderOptions | null) {
    if (this.eof) {
      return this.buffer;
    }
    bytes ||= this.bytes;
    this.buffer = JpxImage.decode(bytes, decoderOptions);
    this.bufferLength = this.buffer.length;
    this.eof = true;

    return this.buffer;
  }

  get canAsyncDecodeImageFromBuffer() {
    return this.stream.isAsync;
  }
}
