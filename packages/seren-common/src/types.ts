import { Name, Ref } from "./primitives";

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

export interface BoxType {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TransformType = [number, number, number, number, number, number];

export type RectType = [number, number, number, number];

export type PointType = [number, number]

export interface PointXYType { x: number, y: number }

export type DestinationType = [Ref, Name, ...number[]];
