import { Dict, Ref } from "seren-common";
import { RectType, AnnotationEditorType } from "seren-common";

export interface AnnotationEditorSerial {
  annotationType: AnnotationEditorType;
  oldAnnotation: Dict;
  ref: Ref;
  popupRef: string;
  deleted: boolean;
  id: string | null;
  structTreeParent: null;
  accessibilityData: {
    structParent: number;
    type: number;
  } | null;
  parentTreeId: number | null;
  bitmap: unknown;
  bitmapId: string | null;
  pageIndex: number;
}

export interface FreeTextEditorSerial extends AnnotationEditorSerial {
  color: Uint8ClampedArray<ArrayBuffer>;
  fontSize: number;
  rect: RectType;
  rotation: number;
  user: string;
  value: string;
}

export interface InkEditorSerial extends AnnotationEditorSerial {
  color: Uint8ClampedArray<ArrayBuffer>;
  opacity: number;
  rect: RectType;
  rotation: number;
  thickness: number;
  paths: { bezier: number[], points: number[] }[]
  outlines: {
    outline: number[];
    points: number[][];
  } | null;
}

export interface StampEditorSerial extends AnnotationEditorSerial {
  rect: RectType;
  rotation: number;
  user: string;
}

export interface HighlightEditorSerial extends AnnotationEditorSerial {
  color: Uint8ClampedArray<ArrayBuffer>;
  opacity: number;
  rect: RectType;
  rotation: number;
  user: string;
  quadPoints: number[];
  outlines: number[][];
}