import { PDFDocumentProxy } from "../api";

export interface PDFLinkService {

  isInPresentationMode: boolean;

  setDocument(pdfDocument: PDFDocumentProxy, baseUrl?: string | null): void;

  goToDestination(_dest: string | Array<string>): Promise<void>;

  goToPage(_val: number | string): void;

  addLinkAttributes(link: HTMLAnchorElement, url: string, newWindow: boolean): void;

  addLinkAttributes(link: HTMLAnchorElement, url: string): void;

  getDestinationHash(dest: string): string;

  getAnchorUrl(anchor: string): string;

  executeSetOCGState(_action: {
    state: string[];
    preserveRB: boolean;
  }): Promise<void>;

  executeNamedAction(_action: string): void;
}
