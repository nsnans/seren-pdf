import { DestinationType } from "../common/types";
import { FileSpecSerializable } from "./message_handler_types";

export enum ViewerPreferenceKeys {
  HideToolbar = "HideToolbar",
  HideMenubar = "HideMenubar",
  HideWindowUI = "HideWindowUI",
  FitWindow = "FitWindow",
  CenterWindow = "CenterWindow",
  DisplayDocTitle = "DisplayDocTitle",
  PickTrayByPDFSize = "PickTrayByPDFSize",
  NonFullScreenPageMode = "NonFullScreenPageMode",
  Direction = "Direction",
  ViewArea = "ViewArea",
  ViewClip = "ViewClip",
  PrintArea = "PrintArea",
  PrintClip = "PrintClip",
  PrintScaling = "PrintScaling",
  Duplex = "Duplex",
  PrintPageRange = "PrintPageRange",
  NumCopies = "NumCopies"
}export type ViewerPreferenceValueTypes = {
  [ViewerPreferenceKeys.HideToolbar]: boolean;
  [ViewerPreferenceKeys.HideMenubar]: boolean;
  [ViewerPreferenceKeys.HideWindowUI]: boolean;
  [ViewerPreferenceKeys.FitWindow]: boolean;
  [ViewerPreferenceKeys.CenterWindow]: boolean;
  [ViewerPreferenceKeys.DisplayDocTitle]: boolean;
  [ViewerPreferenceKeys.PickTrayByPDFSize]: boolean;
  [ViewerPreferenceKeys.NonFullScreenPageMode]: string;
  [ViewerPreferenceKeys.Direction]: string;
  [ViewerPreferenceKeys.ViewArea]: string;
  [ViewerPreferenceKeys.ViewClip]: string;
  [ViewerPreferenceKeys.PrintArea]: string;
  [ViewerPreferenceKeys.PrintClip]: string;
  [ViewerPreferenceKeys.PrintScaling]: string;
  [ViewerPreferenceKeys.Duplex]: string;
  [ViewerPreferenceKeys.PrintPageRange]: number[];
  [ViewerPreferenceKeys.NumCopies]: number;
};
export interface CatalogOpenAction {
  dest: string | DestinationType | null;
  action: string | null;
}
/**
 * Properties correspond to Table 321 of the PDF 32000-1:2008 spec.
 */


export class CatalogMarkInfo {
  Marked = false;
  UserProperties = false;
  Suspects = false;
}

export interface CatalogOutlineItem {
  action: string | null;
  attachment: FileSpecSerializable | null;
  dest: string | DestinationType | null;
  url: string | null;
  unsafeUrl: string | null;
  newWindow: boolean | null;
  setOCGState: {
    state: string[];
    preserveRB: boolean;
  } | null;
  title: string;
  color: Uint8ClampedArray<ArrayBuffer>;
  count: number | null;
  bold: boolean;
  italic: boolean;
  items: CatalogOutlineItem[];
}
export interface CatalogOptionalContentConfig {
  name: string | null;
  creator: string | null;
  baseState: string | null;
  on: string[];
  off: string[];
  order: (string | OptionalContentOrder)[] | null;
  groups: OptionalContentDataGroup[];
}
export interface OptionalContentOrder {
  name: string | null;
  order: (string | OptionalContentOrder)[];
}

export interface OptionalContentDataGroup {
  id: string;
  name: string | null;
  intent: string[] | null;
  usage: {
    print: {
      printState: "ON" | "OFF";
    } | null;
    view: {
      viewState: "ON" | "OFF";
    } | null;
  };
  rbGroups: Set<string>[];
}

