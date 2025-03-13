/* Copyright 2012 Mozilla Foundation
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

import {
  BaseException,
  MissingPDFException,
  UnexpectedResponseException
} from "seren-common";
import { getFilenameFromContentDispositionHeader } from "./content_disposition";
import { isPdfFile } from "./display_utils";
import { isNull } from 'seren-common';

export function createHeaders(isHttp: boolean, httpHeaders: Record<string, string>) {
  const headers = new Headers();

  if (!isHttp || !httpHeaders || typeof httpHeaders !== "object") {
    return headers;
  }
  for (const key in httpHeaders) {
    const val = httpHeaders[key];
    if (val !== undefined) {
      headers.append(key, val);
    }
  }
  return headers;
}

export function validateRangeRequestCapabilities(
  responseHeaders: Headers,
  isHttp: boolean,
  rangeChunkSize: number,
  disableRange: boolean
) {
  type ReturnValueType = {
    allowRangeRequests: boolean,
    suggestedLength: number | null;
  }
  const returnValues: ReturnValueType = {
    allowRangeRequests: false,
    suggestedLength: null,
  };

  const length = parseInt(responseHeaders.get("Content-Length")!, 10);
  if (!Number.isInteger(length)) {
    return returnValues;
  }

  returnValues.suggestedLength = length;

  // 这种优化应该去除掉
  if (length <= 2 * rangeChunkSize) {
    // The file size is smaller than the size of two chunks, so it does not
    // make any sense to abort the request and retry with a range request.
    return returnValues;
  }

  if (disableRange || !isHttp) {
    return returnValues;
  }
  const acceptRanges = responseHeaders.get("Accept-Ranges");
  if (acceptRanges !== "bytes") {
    if (isNull(acceptRanges)) {
      console.warn("Accept-Ranges不应当为空，请检查服务器是否正确处理了AcceptRanges！")
    }
    return returnValues;
  }

  const contentEncoding = responseHeaders.get("Content-Encoding") || "identity";
  if (contentEncoding !== "identity") {
    return returnValues;
  }

  returnValues.allowRangeRequests = true;
  return returnValues;
}

export function extractFilenameFromHeader(responseHeaders: Headers) {
  const contentDisposition = responseHeaders.get("Content-Disposition");
  if (contentDisposition) {
    let filename = getFilenameFromContentDispositionHeader(contentDisposition);
    if (filename.includes("%")) {
      try {
        filename = decodeURIComponent(filename);
      } catch { }
    }
    if (isPdfFile(filename)) {
      return filename;
    }
  }
  return null;
}

export function createResponseStatusError(status: number, url: string): BaseException {
  if (status === 404 || (status === 0 && url.startsWith("file:"))) {
    return new MissingPDFException('Missing PDF "' + url + '".');
  }
  return new UnexpectedResponseException(
    `Unexpected server response (${status}) while retrieving PDF "${url}".`,
    status
  );
}

export function validateResponseStatus(status: number) {
  return status === 200 || status === 206;
}
