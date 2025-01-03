import { OPS } from "../pdf";
import { MutableArray } from "../types";

export const SKIP = 1;

export const OVER = 2;

export const DEFAULT = "DEFAULT";

export interface ProcessOperation {
  fn: OPS | null;
  args: MutableArray<any> | null;
}

export abstract class BaseOperator {

  ensureStateFont(state: State) {
    if (state.font) {
      return;
    }
    const reason = new FormatError(
      "Missing setFont (Tf) operator before text rendering operator."
    );

    if (this.options.ignoreErrors) {
      warn(`ensureStateFont: "${reason}".`);
      return;
    }
    throw reason;
  }
  
}