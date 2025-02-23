import { FontSubstitutionInfo } from "packages/seren-core/src/document/font/font_substitutions";
import { RectType, TransformType } from "../common/types";
import { DictKey } from "../document/primitives";

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
