
export interface DownloadManager {

  download(data: Uint8Array<ArrayBuffer>, url: string, filename: string): void;

  downloadData(data: Uint8Array<ArrayBuffer>, filename: string, contentType: string): void;

  openOrDownloadData(data: Uint8Array<ArrayBuffer>, filename: string, dest: string | null): boolean;

  openOrDownloadData(data: Uint8Array<ArrayBuffer>, filename: string): boolean;
}
