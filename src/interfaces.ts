/* Copyright 2018 Mozilla Foundation
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

import { OnProgressParameters } from "./display/api";

/**
 * Interface that represents PDF data transport. If possible, it allows
 * progressively load entire or fragment of the PDF binary data.
 *
 * @interface
 */
export interface IPDFStream {
  /**
   * Gets a reader for the entire PDF data.
   * @returns {IPDFStreamReader}
   */
  getFullReader(): IPDFStreamReader;

  /**
   * Gets a reader for the range of the PDF data.
   * @param {number} begin - the start offset of the data.
   * @param {number} end - the end offset of the data.
   * @returns {IPDFStreamRangeReader}
   */
  getRangeReader(begin: number, end: number): IPDFStreamRangeReader | null;

  /**
   * Cancels all opened reader and closes all their opened requests.
   * @param {Object} reason - the reason for cancelling
   */
  cancelAllRequests(reason: Error): void;
}

/**
 * Interface for a PDF binary data reader.
 *
 * @interface
 */
export interface IPDFStreamReader {

  /**
     * Sets or gets the progress callback. The callback can be useful when the
     * isStreamingSupported property of the object is defined as false.
     * The callback is called with one parameter: an object with the loaded and
     * total properties.
     */
  onProgress: ((evt: OnProgressParameters) => void) | null;

  /**
   * Gets a promise that is resolved when the headers and other metadata of
   * the PDF data stream are available.
   * @type {Promise}
   */
  get headersReady(): Promise<unknown>;

  /**
   * Gets the Content-Disposition filename. It is defined after the headersReady
   * promise is resolved.
   * @type {string|null} The filename, or `null` if the Content-Disposition
   *                     header is missing/invalid.
   */
  get filename(): string | null;

  /**
   * Gets PDF binary data length. It is defined after the headersReady promise
   * is resolved.
   * @type {number} The data length (or 0 if unknown).
   */
  get contentLength(): number;

  /**
   * Gets ability of the stream to handle range requests. It is defined after
   * the headersReady promise is resolved. Rejected when the reader is cancelled
   * or an error occurs.
   * @type {boolean}
   */
  get isRangeSupported(): boolean;

  /**
   * Gets ability of the stream to progressively load binary data. It is defined
   * after the headersReady promise is resolved.
   * @type {boolean}
   */
  get isStreamingSupported(): boolean;

  /**
   * Requests a chunk of the binary data. The method returns the promise, which
   * is resolved into object with properties "value" and "done". If the done
   * is set to true, then the stream has reached its end, otherwise the value
   * contains binary data. Cancelled requests will be resolved with the done is
   * set to true.
   * @returns {Promise}
   */
  read(): Promise<unknown>;

  /**
   * Cancels all pending read requests and closes the stream.
   * @param {Object} reason
   */
  cancel(reason?: Error): void;
}

/**
 * Interface for a PDF binary data fragment reader.
 *
 * @interface
 */
export interface IPDFStreamRangeReader {
  /**
   * Sets or gets the progress callback. The callback can be useful when the
   * isStreamingSupported property of the object is defined as false.
   * The callback is called with one parameter: an object with the loaded
   * property.
   */
  onProgress: ((evt: OnProgressParameters) => void) | null;

  /**
   * Gets ability of the stream to progressively load binary data.
   * @type {boolean}
   */
  get isStreamingSupported(): boolean;

  /**
   * Requests a chunk of the binary data. The method returns the promise, which
   * is resolved into object with properties "value" and "done". If the done
   * is set to true, then the stream has reached its end, otherwise the value
   * contains binary data. Cancelled requests will be resolved with the done is
   * set to true.
   * @returns {Promise}
   */
  read(): Promise<unknown>;

  /**
   * Cancels all pending read requests and closes the stream.
   * @param {Object} reason
   */
  cancel(reason: Error): void;
}

