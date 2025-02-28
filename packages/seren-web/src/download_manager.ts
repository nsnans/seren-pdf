/* Copyright 2013 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { DownloadManager, isPdfFile } from "seren-viewer";
import { createValidAbsoluteUrl } from "seren-common";

function download(blobUrl: string, filename: string) {
  const a = document.createElement("a");
  if (!a.click) {
    throw new Error('DownloadManager: "a.click()" is not supported.');
  }
  a.href = blobUrl;
  a.target = "_parent";
  // Use a.download if available. This increases the likelihood that
  // the file is downloaded instead of opened by another PDF plugin.
  if ("download" in a) {
    a.download = filename;
  }
  // <a> must be in the document for recent Firefox versions,
  // otherwise .click() is ignored.
  (document.body || document.documentElement).append(a);
  a.click();
  a.remove();
}

export class WebDownloadManager implements DownloadManager {

  #openBlobUrls = new WeakMap();

  downloadData(data: Uint8Array<ArrayBuffer>, filename: string, contentType: string) {
    const blobUrl = URL.createObjectURL(
      new Blob([data], { type: contentType })
    );
    download(blobUrl, filename);
  }

  /**
   * @returns Indicating if the data was opened.
   */
  openOrDownloadData(data: Uint8Array<ArrayBuffer>, filename: string, dest: string | null = null) {
    const isPdfData = isPdfFile(filename);
    const contentType = isPdfData ? "application/pdf" : "";

    if (isPdfData) {
      let blobUrl = this.#openBlobUrls.get(data);
      if (!blobUrl) {
        blobUrl = URL.createObjectURL(new Blob([data], { type: contentType }));
        this.#openBlobUrls.set(data, blobUrl);
      }
      // The current URL is the viewer, let's use it and append the file.
      let viewerUrl = "?file=" + encodeURIComponent(blobUrl + "#" + filename);
      if (dest) {
        viewerUrl += `#${escape(dest)}`;
      }

      try {
        window.open(viewerUrl);
        return true;
      } catch (ex) {
        console.error(`openOrDownloadData: ${ex}`);
        // Release the `blobUrl`, since opening it failed, and fallback to
        // downloading the PDF file.
        URL.revokeObjectURL(blobUrl);
        this.#openBlobUrls.delete(data);
      }
    }

    this.downloadData(data, filename, contentType);
    return false;
  }

  download(data: Uint8Array<ArrayBuffer>, url: string, filename: string) {
    let blobUrl;
    if (data) {
      blobUrl = URL.createObjectURL(
        new Blob([data], { type: "application/pdf" })
      );
    } else {
      if (!createValidAbsoluteUrl(url, "http://example.com")) {
        console.error(`download - not a valid URL: ${url}`);
        return;
      }
      blobUrl = url + "#pdfjs.action=download";
    }
    download(blobUrl, filename);
  }
}
