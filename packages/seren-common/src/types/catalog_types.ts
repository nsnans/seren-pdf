import { DestinationType } from "../common/common_types";

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
}

export type ViewerPreferenceValueTypes = {
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

