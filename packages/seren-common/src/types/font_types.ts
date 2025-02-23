import { RectType, TransformType } from "../common/types";
import { DictKey } from "../document/primitives";
import { OperatorListIR } from "./operator_types";

export interface CssFontInfo {
  fontFamily: string;
  fontWeight: number;
  italicAngle: number;
  lineHeight?: number;
  metrics: { lineHeight: number; lineGap: number; };
}

export interface FontSubstitutionInfo {
  css: string;
  guessFallback: boolean;
  loadedName: string;
  baseFontName: string;
  src: string;
  style: {
    style: string;
    weight: string;
  } | null;
}

export interface FontExportData {
  ascent: number;
  bbox: RectType | null;
  black: boolean | null;
  bold: boolean | null;
  charProcOperatorList: Map<DictKey, OperatorListIR> | null;
  composite: boolean;
  cssFontInfo: CssFontInfo | null;
  data: Uint8Array<ArrayBuffer> | null;
  defaultVMetrics: number[] | null;
  defaultWidth: number;
  descent: number;
  fallbackName: string;
  fontMatrix: TransformType;
  isInvalidPDFjsFont: boolean;
  isType3Font: boolean;
  italic: boolean | null;
  loadedName: string | null;
  mimetype: string | null;
  missingFile: boolean;
  name: string;
  remeasure: boolean | null;
  subtype: string | null;
  systemFontInfo: FontSubstitutionInfo | null;
  type: string;
  vertical: boolean | null;
}

