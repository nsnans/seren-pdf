
export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array |
  Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;


export interface MutableArray<T> {
  readonly length: number;
  [n: number]: T;
  [Symbol.iterator](): ArrayIterator<T>;
  set?: (data: MutableArray<T>, offset: number) => void;
  subarray?: (begin: number, end?: number) => MutableArray<T>;
}

export interface Shiftable<T> {
  shift(): T | undefined;
}

export function shiftable<T>(obj: unknown): obj is Shiftable<T> {
  return !!((<any>obj)?.shift);
}