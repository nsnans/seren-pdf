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
