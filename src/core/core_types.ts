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

export interface StreamGetOperatorListParameters {
  pageIndex: number;
  intent: number;
  cacheKey: string;
  annotationStorage: Map<string, Record<string, any>> | null;
  modifiedIds: Set<string>;
}