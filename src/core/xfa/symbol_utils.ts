/* Copyright 2021 Mozilla Foundation
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

// We use these symbols to avoid name conflict between tags
// and properties/methods names.
const $content = Symbol("content");
const $nsAttributes = Symbol();
const $root = Symbol("root");
const $toHTML = Symbol();
const $toString = Symbol();
const $toStyle = Symbol();
const $uid = Symbol("uid");

export {
  $content,
  $nsAttributes,
  $root,
  $toHTML,
  $toString,
  $toStyle,
  $uid
};

