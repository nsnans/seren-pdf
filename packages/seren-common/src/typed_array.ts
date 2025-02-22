
// 使用TypedArray来统一抽象所有的TypeArray，不然会造成很多问题
// 到处使用 “|” 来将各种各样的类型强制绑定在一起，也真是醉了
export interface GenericTypedArray<TArrayBuffer extends ArrayBufferLike, THIS> {

  readonly BYTES_PER_ELEMENT: number;

  readonly buffer: TArrayBuffer;

  readonly byteLength: number;

  readonly byteOffset: number;

  readonly length: number;

  readonly [Symbol.toStringTag]: string;

  [index: number]: number;

  [Symbol.iterator](): ArrayIterator<number>;

  copyWithin(target: number, start: number, end?: number): THIS;

  every(predicate: (value: number, index: number, array: THIS) => unknown, thisArg?: any): boolean;

  fill(value: number, start?: number, end?: number): THIS;

  filter(predicate: (value: number, index: number, array: THIS) => any, thisArg?: any): THIS;

  find(predicate: (value: number, index: number, obj: THIS) => boolean, thisArg?: any): number | undefined;

  findIndex(predicate: (value: number, index: number, obj: THIS) => boolean, thisArg?: any): number;

  forEach(callbackfn: (value: number, index: number, array: THIS) => void, thisArg?: any): void;

  indexOf(searchElement: number, fromIndex?: number): number;

  join(separator?: string): string;

  lastIndexOf(searchElement: number, fromIndex?: number): number;

  map(callbackfn: (value: number, index: number, array: THIS) => number, thisArg?: any): THIS;

  reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: THIS) => number): number;

  reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: THIS) => number, initialValue: number): number;

  reduce<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: THIS) => U, initialValue: U): U;

  reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: THIS) => number): number;

  reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: THIS) => number, initialValue: number): number;

  reduceRight<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: THIS) => U, initialValue: U): U;

  reverse(): THIS;

  set(array: ArrayLike<number>, offset?: number): void;

  slice(start?: number, end?: number): THIS;

  some(predicate: (value: number, index: number, array: THIS) => unknown, thisArg?: any): boolean;

  sort(compareFn?: (a: number, b: number) => number): THIS;

  subarray(begin?: number, end?: number): THIS;

  toLocaleString(): string;

  toString(): string;

  valueOf(): THIS;

  toLocaleString(locales: string | string[], options?: Intl.NumberFormatOptions): string;

  /**
   * Returns an array of key, value pairs for every entry in the array
   */
  entries(): ArrayIterator<[number, number]>;
  /**
   * Returns an list of keys in the array
   */
  keys(): ArrayIterator<number>;
  /**
   * Returns an list of values in the array
   */
  values(): ArrayIterator<number>;

  includes(searchElement: number, fromIndex?: number): boolean;

  at(index: number): number | undefined;

  findLast<S extends number>(
    predicate: (
      value: number,
      index: number,
      array: THIS,
    ) => value is S,
    thisArg?: any,
  ): S | undefined;
  findLast(
    predicate: (value: number, index: number, array: THIS) => unknown,
    thisArg?: any,
  ): number | undefined;

  findLastIndex(
    predicate: (value: number, index: number, array: THIS) => unknown,
    thisArg?: any,
  ): number;

  toReversed(): THIS;

  toSorted(compareFn?: (a: number, b: number) => number): THIS;

  with(index: number, value: number): THIS;

}

// 主要是为了抽象出Uint8Array和Uint8ClampArray，这两个到处拼接，太操蛋了
export interface Uint8TypedArray extends GenericTypedArray<ArrayBuffer, Uint8TypedArray> { }

