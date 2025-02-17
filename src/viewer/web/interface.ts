import { PDFDocumentProxy } from "../../display/api";

export interface DocumentOwner {
  setDocument(pdfDocument: PDFDocumentProxy | null): void;
}