import { OPS } from "../utils/util";
import { AnnotationEditorSerial } from "./annotation_types";


export interface OperatorListIR {

  fnArray: OPS[];

  argsArray: (any[] | null)[];

  length: number;

  lastChunk: boolean;

  separateAnnots: {
    form: boolean;
    canvas: boolean;
  } | null;

}export interface OpertaorListChunk {
  fnArray: OPS[];
  argsArray: (any[] | null)[];
  lastChunk: boolean;
  separateAnnots: {
    form: boolean;
    canvas: boolean;
  } | null;
  length: number;
}
export interface StreamGetOperatorListParameters {
  pageIndex: number;
  intent: number;
  cacheKey: string;
  annotationStorage: Map<string, AnnotationEditorSerial> | null;
  modifiedIds: Set<string>;
}

