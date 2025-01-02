
export type TypedArray = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array |
  Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;


export interface MutableArray<T> {
  readonly length: number;
  [n: number]: T;
  [Symbol.iterator](): ArrayIterator<T>;
  set?: (data: MutableArray<T>, offset: number) => void;
  subarray?: (begin: number, end?: number) => MutableArray<T>;
}