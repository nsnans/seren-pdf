import { Dict, Ref } from "../../../core/primitives";
import { AnnotationEditorType } from "../../../shared/util";

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

}

export interface InkEditorSerial extends AnnotationEditorSerial {

}

export interface StampEditorSerial extends AnnotationEditorSerial {

}

export interface HighlightEditorSerial extends AnnotationEditorSerial {

}