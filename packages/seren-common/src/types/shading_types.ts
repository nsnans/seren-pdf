import { PointType, RectType, TransformType } from "../common/common_types";
import { OperatorListIR } from "./operator_types";

export interface FigureType {
  type: string;
  coords: Int32Array<ArrayBuffer>;
  colors: Int32Array<ArrayBuffer>;
  verticesPerRow?: number;
}

export type MeshShadingPatternIR = [string, number, PointType[] | Float32Array,
  [number, number, number][] | Uint8Array | (Uint8ClampedArray | Uint8Array)[],
  FigureType[], RectType, RectType | null, Uint8ClampedArray | null, null];

export type RadialAxialShadingIR = [
  "RadialAxial", string, RectType | null, [number, string][],
  number[], number[], number | null, number | null
];
export type TilingPatternIR = [
  "TilingPattern",
  Uint8ClampedArray<ArrayBuffer> | null,
  OperatorListIR,
  TransformType,
  RectType,
  number, number,
  number, number
];

