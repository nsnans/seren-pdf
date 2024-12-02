export interface ImageMask {
  data: Uint8Array | null;
  width: number;
  height: number;
  interpolate: number[];
  cached?: boolean;
  dataLen?: number;
  bitmap?: ImageBitmap;
}

export interface SingleOpaquePixelImageMask {
  isSingleOpaquePixel: boolean;
}

export interface SMaskOptions {
  transferMap?: Uint8Array;
  subtype: string;
  backdrop: number[];
}