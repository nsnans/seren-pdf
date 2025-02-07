import { Uint8TypedArray } from "./common/typed_array";
import { JpxDecoderOptions } from "./core/image";

export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array |
  Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;


export interface MutableArray<T> {
  length: number;
  [n: number]: T;
  [Symbol.iterator](): ArrayIterator<T>;
  set?: (data: MutableArray<T>, offset: number) => void;
  subarray?: (begin: number, end?: number) => MutableArray<T>;
}

export interface Shiftable<T> {
  shift(): T | undefined;
}

export interface Popable<T> {
  pop(): T | undefined;
}

export function shiftable<T>(obj: unknown): obj is Shiftable<T> {
  return !!((<any>obj)?.shift);
}

export interface OpenJPEGModule {
  decode(data: Uint8TypedArray, option: JpxDecoderOptions | {} | null): Uint8Array<ArrayBuffer>;
}

export interface BoxType {
  x: number;
  y: number;
  width: number;
  height: number;
}
