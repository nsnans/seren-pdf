import { Event } from "./scripting_api/event";
import { TypedArray } from "./types";
import { IntentStateOperatorList } from './display/api';

// 扩展 window 对象，添加 一些全局 属性
export declare global {

  interface Window {
    chrome?: boolean;
  }

  interface EventTarget {
    name: string;
  }

  /**
   * 因为DataView要做Uint8Array的构造参数。但是DataView又不能做Uint8Array的构造函数。
   * 需要返回一个数字的迭代器，因此在这里需要补一下。我不太确定这是不是因为node相关导致的。
   */
  interface DataView<TArrayBuffer extends ArrayBufferLike> {
    [Symbol.iterator](): Iterator<number, number, number>;
  }

  interface CanvasRenderingContext2D {
    fillRule?: string;
  }

  interface CanvasRenderingContext2D {
    _removeMirroring?: () => void
    __originalSave?: () => void;
    __originalRestore?: () => void;
    __originalRotate?: (angle: number) => void;
    __originalScale?: (x: number, y: number) => void;
    __originalTranslate?: (x: number, y: number) => void;
    __originalTransform?: (a: number, b: number, c: number, d: number, e: number, f: number) => void;
    __originalSetTransform?: {
      (a: number, b: number, c: number, d: number, e: number, f: number): void;
      (transform?: DOMMatrix2DInit | undefined): void;
    };
    __originalResetTransform?: () => void;
    __originalClip?: {
      (fillRule?: CanvasFillRule | undefined): void;
      (path: Path2D, fillRule?: CanvasFillRule | undefined): void;
    }
    __originalMoveTo?: (x: number, y: number) => void;
    __originalLineTo?: (x: number, y: number) => void;
    __originalBezierCurveTo?: (cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) => void;
    __originalRect?: (x: number, y: number, w: number, h: number) => void;
    __originalClosePath?: () => void;
    __originalBeginPath?: () => void;
  }

  interface HTMLInputElement {
    exportValue?: string;
  }

  interface FocusOptions {
    focusVisible?: boolean;
  }

  interface AddEventListenerOptions {
    useCapture?: boolean;
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

  declare interface ImageDecodeOption {
    frameIndex?: number;
    completeFramesOnly?: boolean;
  }

  declare interface ImageDecoder {
    static isTypeSupported(type: string): Promise<boolean>;
    new: (options: ImageDecoderOptions) => ImageDecoder;
    close(): void;
    decode(options?: ImageDecodeOption): Promise<{ image: VideoFrame, complete: boolean }>;
    reset(): void;
  }

  declare var FontInspector = {
    enabled: boolean
  }

  declare interface Document {
    blockUnblockOnload?: (_flag: boolean) => void;
  }

  declare interface MouseEvent {
    originalTarget: Element | null;
  }

  export declare var ImageDecoder: {
    prototype: ImageDecoder;
    new(options: ImageDecoderOption): ImageDecoder;
    static isTypeSupported(type: string): Promise<boolean>;
  };
}



