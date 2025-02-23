import { Ref, unreachable } from "seren-common";

interface DocIdOwner {
  docId: string;
}

export class GlobalIdFactory {

  readonly docIdOwner: DocIdOwner;

  readonly fontIdCounters: { font: number; };

  constructor(docIdOwner: DocIdOwner, idCounters: { font: number }) {
    this.docIdOwner = docIdOwner;
    this.fontIdCounters = idCounters;
  }

  getDocId() {
    return `g_${this.docIdOwner.docId}`;
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
    super(parent.docIdOwner, parent.fontIdCounters);
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