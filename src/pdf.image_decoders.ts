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

import { Jbig2Error, Jbig2Image } from "./core/jbig2";
import { JpegError, JpegImage } from "./core/jpg";
import { JpxError, JpxImage } from "./core/jpx";
import { PlatformHelper } from "./platform/platform_helper";
import { getVerbosityLevel, setVerbosityLevel } from "./shared/util";

//@ts-ignore
const pdfjsVersion =
  typeof PlatformHelper.hasDefined() ? PlatformHelper.bundleVersion() : void 0;

//@ts-ignore
const pdfjsBuild =
  typeof PlatformHelper.hasDefined() ? PlatformHelper.bundleBuild() : void 0;

export {
  getVerbosityLevel,
  Jbig2Error,
  Jbig2Image,
  JpegError,
  JpegImage,
  JpxError,
  JpxImage,
  setVerbosityLevel
};
