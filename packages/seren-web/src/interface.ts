import { PDFDocumentProxy } from "seren-viewer";

export interface DocumentOwner {
  setDocument(pdfDocument: PDFDocumentProxy | null): void;
}