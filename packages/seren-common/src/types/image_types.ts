import { TransformType, RectType } from "../common/common_types";
import { Uint8TypedArray } from "../common/typed_array";

export interface ImageMask {
  data: Uint8TypedArray | null;
  width: number;
  height: number;
  interpolate: number[];
  cached?: boolean;
  dataLen?: number;
  bitmap?: ImageBitmap | VideoFrame;
  ref?: string | null;
}

export interface JpxDecoderOptions {

  numComponents: number;

  isIndexedColormap: boolean;

  smaskInData?: boolean;

}
export interface OptionalContent {
  type: string;
  id?: string | null;
  ids?: (string | null)[];
  expression?: (string | string[])[] | null;
  policy?: string | null;
}
export interface GroupOptions {
  matrix: TransformType | null;
  bbox: RectType | null;
  smask: SMaskOptions | null;
  isolated: boolean;
  knockout: boolean;
}
export interface SMaskOptions {
  transferMap?: Uint8Array<ArrayBuffer>;
  subtype: string;
  backdrop: number[] | Uint8ClampedArray<ArrayBuffer>;
}


