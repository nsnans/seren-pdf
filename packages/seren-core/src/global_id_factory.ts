import { unreachable } from "../shared/util";
import { PDFManager } from "./pdf_manager";
import { Ref } from "../../seren-common/src/primitives";

export class GlobalIdFactory {

  readonly pdfManager: PDFManager;

  readonly fontIdCounters: { font: number; };

  constructor(pdfManager: PDFManager, idCounters: { font: number }) {
    this.pdfManager = pdfManager;
    this.fontIdCounters = idCounters;
  }

  getDocId() {
    return `g_${this.pdfManager.docId}`;
  }

  createFontId() {
    return `f${++this.fontIdCounters.font}`;
  }

  createObjId(): string {
    unreachable('method is not implemented');
  }
  getPageObjId(): string {
    unreachable('method is not implemented');
  }
};

export class LocalIdFactory extends GlobalIdFactory {

  readonly pageIndex: number;

  readonly objIdCounters: { obj: number; };

  readonly ref: Ref;

  constructor(parent: GlobalIdFactory, pageIndex: number
    , objIdCounters: { obj: number }, ref: Ref) {
    super(parent.pdfManager, parent.fontIdCounters);
    this.pageIndex = pageIndex;
    this.objIdCounters = objIdCounters;
    this.ref = ref;
  }

  createObjId() {
    return `p${this.pageIndex}_${++this.objIdCounters.obj}`;
  }
  getPageObjId() {
    return `p${this.ref!.toString()}`;
  }

}