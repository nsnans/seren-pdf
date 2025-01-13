
// 使用TypedArray来统一抽象所有的TypeArray，不然会造成很多问题
// 到处使用 “|” 来将各种各样的类型强制绑定在一起，也真是醉了
export interface GenericTypedArray<TArrayBuffer extends ArrayBufferLike> {

  readonly BYTES_PER_ELEMENT: number;

  readonly buffer: TArrayBuffer;

  readonly byteLength: number;

  readonly byteOffset: number;

  readonly length: number;

  readonly [Symbol.toStringTag]: string;

  [index: number]: number;

  [Symbol.iterator](): ArrayIterator<number>;

  copyWithin(target: number, start: number, end?: number): GenericTypedArray<TArrayBuffer>;

  every(predicate: (value: number, index: number, array: GenericTypedArray<TArrayBuffer>) => unknown, thisArg?: any): boolean;

  fill(value: number, start?: number, end?: number): GenericTypedArray<TArrayBuffer>;

  filter(predicate: (value: number, index: number, array: GenericTypedArray<TArrayBuffer>) => any, thisArg?: any): GenericTypedArray<TArrayBuffer>;

  find(predicate: (value: number, index: number, obj: GenericTypedArray<TArrayBuffer>) => boolean, thisArg?: any): number | undefined;

  findIndex(predicate: (value: number, index: number, obj: GenericTypedArray<TArrayBuffer>) => boolean, thisArg?: any): number;

  forEach(callbackfn: (value: number, index: number, array: GenericTypedArray<TArrayBuffer>) => void, thisArg?: any): void;

  indexOf(searchElement: number, fromIndex?: number): number;

  join(separator?: string): string;

  lastIndexOf(searchElement: number, fromIndex?: number): number;

  map(callbackfn: (value: number, index: number, array: GenericTypedArray<TArrayBuffer>) => number, thisArg?: any): GenericTypedArray<TArrayBuffer>;

  reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: GenericTypedArray<TArrayBuffer>) => number): number;

  reduce(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: GenericTypedArray<TArrayBuffer>) => number, initialValue: number): number;

  reduce<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: GenericTypedArray<TArrayBuffer>) => U, initialValue: U): U;

  reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: GenericTypedArray<TArrayBuffer>) => number): number;

  reduceRight(callbackfn: (previousValue: number, currentValue: number, currentIndex: number, array: GenericTypedArray<TArrayBuffer>) => number, initialValue: number): number;

  reduceRight<U>(callbackfn: (previousValue: U, currentValue: number, currentIndex: number, array: GenericTypedArray<TArrayBuffer>) => U, initialValue: U): U;

  reverse(): GenericTypedArray<TArrayBuffer>;

  set(array: ArrayLike<number>, offset?: number): void;

  slice(start?: number, end?: number): GenericTypedArray<TArrayBuffer>;

  some(predicate: (value: number, index: number, array: GenericTypedArray<TArrayBuffer>) => unknown, thisArg?: any): boolean;

  sort(compareFn?: (a: number, b: number) => number): GenericTypedArray<TArrayBuffer>;

  subarray(begin?: number, end?: number): GenericTypedArray<TArrayBuffer>;

  toLocaleString(): string;

  toString(): string;

  valueOf(): GenericTypedArray<TArrayBuffer>;

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
      array: GenericTypedArray<TArrayBuffer>,
    ) => value is S,
    thisArg?: any,
  ): S | undefined;
  findLast(
    predicate: (value: number, index: number, array: GenericTypedArray<TArrayBuffer>) => unknown,
    thisArg?: any,
  ): number | undefined;

  findLastIndex(
    predicate: (value: number, index: number, array: GenericTypedArray<TArrayBuffer>) => unknown,
    thisArg?: any,
  ): number;

  toReversed(): GenericTypedArray<TArrayBuffer>;

  toSorted(compareFn?: (a: number, b: number) => number): GenericTypedArray<TArrayBuffer>;

  with(index: number, value: number): GenericTypedArray<TArrayBuffer>;

}

// 主要是为了抽象出Uint8Array和Uint8ClampArray，这两个到处拼接，太操蛋了
export interface Uint8TypedArray extends GenericTypedArray<ArrayBuffer> { }

// 很多地方一会儿传 number[]，一会儿传Uint8ClampedArray，一会儿传Uin8Array
// 最好统一成 Iterable<number>，不做特殊抽象的话，就要做大量的兼容了。
export interface Iterable {

}
