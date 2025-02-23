import { Uint8TypedArray, Ref } from "seren-common";
import { JpxDecoderOptions } from "./image";
import { JpegStream } from "../stream/jpeg_stream";
import { Stream } from "../stream/stream";

export interface OpenJPEGModule {
  decode(data: Uint8TypedArray, option: JpxDecoderOptions | {} | null): Uint8Array<ArrayBuffer>;
}

// 数据类型实在是太多太杂了，因此需要收纳起来，避免json对象传来传去
export interface CreateStampImageResult {
  width: number;
  height: number;
  imageStream: Stream | null;
  smaskStream: Stream | null;
  imageRef?: JpegStream | Ref;
}
export interface ImageMask {
  data: Uint8TypedArray | null;
  width: number;
  height: number;
  interpolate: number[];
  cached?: boolean;
  dataLen?: number;
  bitmap?: ImageBitmap | VideoFrame;
  ref?: string | null;
}export interface SMaskOptions {
  transferMap?: Uint8Array<ArrayBuffer>;
  subtype: string;
  backdrop: number[] | Uint8ClampedArray<ArrayBuffer>;
}
export interface SingleOpaquePixelImageMask {
  isSingleOpaquePixel: boolean;
}

