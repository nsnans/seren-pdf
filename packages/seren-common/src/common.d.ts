
export declare global {

  declare interface ImageDecoder {
    static isTypeSupported(type: string): Promise<boolean>;
    new: (options: ImageDecoderOptions) => ImageDecoder;
    close(): void;
    decode(options?: ImageDecodeOption): Promise<{ image: VideoFrame, complete: boolean }>;
    reset(): void;
  }

  export declare var ImageDecoder: {
    prototype: ImageDecoder;
    new(options: ImageDecoderOption): ImageDecoder;
    static isTypeSupported(type: string): Promise<boolean>;
  };


  declare interface ImageDecodeOption {
    frameIndex?: number;
    completeFramesOnly?: boolean;
  }
  
  declare interface ImageDecoderOptions {
    type: string;
    data: ArrayBuffer | DataView | ReadableStream | TypedArray;
    premultiplyAlpha?: "none" | "premultiply" | "default";
    colorSpaceConversion?: "none" | "default";
    desiredWidth?: number;
    desiredHeight?: number;
    preferAnimation?: boolean;
    tranfer: ArrayBuffer[];
  }
  
}