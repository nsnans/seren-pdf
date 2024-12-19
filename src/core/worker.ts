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

import { DocParams } from "../display/api";
import { PlatformHelper } from "../platform/platform_helper";
import { MessageHandler } from "../shared/message_handler";
import { SaveDocumentMessage } from "../shared/message_handler_types";
import {
  AbortException,
  assert,
  getVerbosityLevel,
  info,
  InvalidPDFException,
  isNodeJS,
  MissingPDFException,
  PasswordException,
  setVerbosityLevel,
  stringToPDFString,
  UnexpectedResponseException,
  UnknownErrorException,
  VerbosityLevel,
  warn,
} from "../shared/util";
import { AnnotationFactory } from "./annotation";
import { clearGlobalCaches } from "./cleanup_helper";
import { StreamGetOperatorListParameters, StreamSink } from "./core_types";
import {
  arrayBuffersToBytes,
  getNewAnnotationsMap,
  XRefParseException,
} from "./core_utils";
import { LinearizationInterface } from "./parser";
import { LocalPDFManager, NetworkPDFManager, PDFManager, PDFManagerArgs } from "./pdf_manager";
import { Dict, DictKey, isDict, Ref } from "./primitives";
import { Stream } from "./stream";
import { StructTreeRoot } from "./struct_tree";
import { PDFWorkerStream } from "./worker_stream";
import { incrementalUpdate } from "./writer";
import { XRef } from "./xref";

class WorkerTask {

  protected _capability = Promise.withResolvers();

  public terminated = false;

  public name: string;

  constructor(name: string) {
    this.name = name;
  }

  get finished() {
    return this._capability.promise;
  }

  finish() {
    this._capability.resolve(null);
  }

  terminate() {
    this.terminated = true;
  }

  ensureNotTerminated() {
    if (this.terminated) {
      throw new Error("Worker task was terminated");
    }
  }
}

class WorkerMessageHandler {
  static setup(handler: MessageHandler, port) {
    let testMessageProcessed = false;
    handler.on("test", function (data) {
      if (testMessageProcessed) {
        return; // we already processed 'test' message once
      }
      testMessageProcessed = true;

      // Ensure that `TypedArray`s can be sent to the worker.
      handler.send("test", data instanceof Uint8Array);
    });

    handler.on("configure", function (data) {
      setVerbosityLevel(data.verbosity);
    });

    handler.on("GetDocRequest", function (data: DocParams) {
      return WorkerMessageHandler.createDocumentHandler(data, port);
    });
  }

  static createDocumentHandler(docParams: DocParams | null, port) {
    // This context is actually holds references on pdfManager and handler,
    // until the latter is destroyed.
    let pdfManager: PDFManager | null;
    let terminated = false;
    let cancelXHRs: ((reason: any) => void) | null = null;
    const WorkerTasks = new Set<WorkerTask>();
    const verbosity = getVerbosityLevel();

    const { docId, apiVersion } = docParams!;
    const workerVersion = !PlatformHelper.hasDefined() || PlatformHelper.isTesting()
      ? PlatformHelper.bundleVersion() : null;
    if (apiVersion !== workerVersion) {
      throw new Error(
        `The API version "${apiVersion}" does not match ` +
        `the Worker version "${workerVersion}".`
      );
    }

    if (PlatformHelper.isGeneric()) {
      // Fail early, and predictably, rather than having (some) fonts fail to
      // load/render with slightly cryptic error messages in environments where
      // the `Array.prototype` has been *incorrectly* extended.
      //
      // PLEASE NOTE: We do *not* want to slow down font parsing by adding
      //              `hasOwnProperty` checks all over the code-base.
      const enumerableProperties = [];
      for (const property in []) {
        enumerableProperties.push(property);
      }
      if (enumerableProperties.length) {
        throw new Error(
          "The `Array.prototype` contains unexpected enumerable properties: " +
          enumerableProperties.join(", ") +
          "; thus breaking e.g. `for...in` iteration of `Array`s."
        );
      }
    }
    const workerHandlerName = docId + "_worker";
    let handler: MessageHandler | null = new MessageHandler(workerHandlerName, docId, port);

    function ensureNotTerminated() {
      if (terminated) {
        throw new Error("Worker was terminated");
      }
    }

    function startWorkerTask(task: WorkerTask) {
      WorkerTasks.add(task);
    }

    function finishWorkerTask(task: WorkerTask) {
      task.finish();
      WorkerTasks.delete(task);
    }

    async function loadDocument(recoveryMode: boolean) {
      await pdfManager!.ensureDoc("checkHeader");
      await pdfManager!.ensureDoc("parseStartXRef");
      await pdfManager!.ensureDoc("parse", [recoveryMode]);

      // Check that at least the first page can be successfully loaded,
      // since otherwise the XRef table is definitely not valid.
      await pdfManager!.ensureDoc("checkFirstPage", [recoveryMode]);
      // Check that the last page can be successfully loaded, to ensure that
      // `numPages` is correct, and fallback to walking the entire /Pages-tree.
      await pdfManager!.ensureDoc("checkLastPage", [recoveryMode]);

      const [numPages, fingerprints] = await Promise.all([
        pdfManager!.ensureDoc("numPages") as Promise<number>,
        pdfManager!.ensureDoc("fingerprints"),
      ]);


      return { numPages, fingerprints };
    }

    function getPdfManager({
      data,
      password,
      disableAutoFetch,
      rangeChunkSize,
      length,
      docBaseUrl,
      evaluatorOptions,
    }: DocParams): Promise<PDFManager> {
      const pdfManagerArgs: PDFManagerArgs = {
        source: <Uint8Array | null>null,
        disableAutoFetch,
        docBaseUrl,
        docId,
        evaluatorOptions,
        handler: handler!,
        length,
        password,
        rangeChunkSize,
      };
      const pdfManagerCapability = <PromiseWithResolvers<PDFManager>>Promise.withResolvers();
      let newPdfManager: PDFManager | null;

      if (data) {
        try {
          pdfManagerArgs.source = data;

          newPdfManager = new LocalPDFManager(pdfManagerArgs);
          pdfManagerCapability.resolve(newPdfManager);
        } catch (ex) {
          pdfManagerCapability.reject(ex);
        }
        return pdfManagerCapability.promise;
      }

      let pdfStream, cachedChunks: ArrayBufferLike[] = [], loaded = 0;
      try {
        pdfStream = new PDFWorkerStream(handler!);
      } catch (ex) {
        pdfManagerCapability.reject(ex);
        return pdfManagerCapability.promise;
      }

      const fullRequest = pdfStream.getFullReader();
      fullRequest.headersReady
        .then(function () {
          if (!fullRequest.isRangeSupported) {
            return;
          }
          pdfManagerArgs.source = pdfStream;
          pdfManagerArgs.length = fullRequest.contentLength!;
          // We don't need auto-fetch when streaming is enabled.
          pdfManagerArgs.disableAutoFetch ||= fullRequest.isStreamingSupported;

          newPdfManager = new NetworkPDFManager(pdfManagerArgs);
          // There may be a chance that `newPdfManager` is not initialized for
          // the first few runs of `readchunk` block of code. Be sure to send
          // all cached chunks, if any, to chunked_stream via pdf_manager.
          for (const chunk of cachedChunks) {
            newPdfManager!.sendProgressiveData(chunk);
          }

          cachedChunks = [];
          pdfManagerCapability.resolve(newPdfManager);
          cancelXHRs = null;
        })
        .catch(function (reason) {
          pdfManagerCapability.reject(reason);
          cancelXHRs = null;
        });

      new Promise(function (_resolve, reject) {
        const readChunk = function ({ value, done }: { value: ArrayBufferLike | undefined, done: boolean }) {
          try {
            ensureNotTerminated();
            if (done) {
              if (!newPdfManager) {
                const pdfFile = arrayBuffersToBytes(cachedChunks);
                cachedChunks = [];

                if (length && pdfFile.length !== length) {
                  warn("reported HTTP length is different from actual");
                }
                pdfManagerArgs.source = pdfFile;

                newPdfManager = new LocalPDFManager(pdfManagerArgs);
                pdfManagerCapability.resolve(newPdfManager);
              }
              cancelXHRs = null;
              return;
            }
            if (PlatformHelper.isTesting()) {
              assert(
                value instanceof ArrayBuffer,
                "readChunk (getPdfManager) - expected an ArrayBuffer."
              );
            }
            loaded += value!.byteLength;

            if (!fullRequest.isStreamingSupported) {
              handler!.send("DocProgress", {
                loaded,
                total: Math.max(loaded, fullRequest.contentLength || 0),
              });
            }

            if (newPdfManager) {
              newPdfManager.sendProgressiveData(value!);
            } else {
              cachedChunks.push(value!);
            }
            fullRequest.read().then(readChunk, reject);
          } catch (e) {
            reject(e);
          }
        };
        fullRequest.read().then(readChunk, reject);
      }).catch(function (e) {
        pdfManagerCapability.reject(e);
        cancelXHRs = null;
      });

      cancelXHRs = function (reason: any) {
        pdfStream.cancelAllRequests(reason);
      };

      return pdfManagerCapability.promise;
    }

    function setupDoc(data: DocParams) {
      function onSuccess(doc) {
        ensureNotTerminated();
        handler!.send("GetDoc", { pdfInfo: doc });
      }

      function onFailure(ex: any) {
        ensureNotTerminated();

        if (ex instanceof PasswordException) {
          const task = new WorkerTask(`PasswordException: response ${ex.code}`);
          startWorkerTask(task);

          (handler!.sendWithPromise("PasswordRequest", ex) as Promise<{ password: string }>)
            .then(function ({ password }: { password: string }) {
              finishWorkerTask(task);
              pdfManager!.updatePassword(password);
              pdfManagerReady();
            })
            .catch(function () {
              finishWorkerTask(task);
              handler!.send("DocException", ex);
            });
        } else if (
          ex instanceof InvalidPDFException ||
          ex instanceof MissingPDFException ||
          ex instanceof UnexpectedResponseException ||
          ex instanceof UnknownErrorException
        ) {
          handler!.send("DocException", ex);
        } else {
          handler!.send(
            "DocException",
            new UnknownErrorException(ex.message, ex.toString())
          );
        }
      }

      function pdfManagerReady() {
        ensureNotTerminated();

        loadDocument(false).then(onSuccess, function (reason) {
          ensureNotTerminated();

          // Try again with recoveryMode == true
          if (!(reason instanceof XRefParseException)) {
            onFailure(reason);
            return;
          }
          pdfManager!.requestLoadedStream().then(function () {
            ensureNotTerminated();

            loadDocument(true).then(onSuccess, onFailure);
          });
        });
      }

      ensureNotTerminated();

      getPdfManager(data)
        .then(function (newPdfManager: PDFManager) {
          if (terminated) {
            // We were in a process of setting up the manager, but it got
            // terminated in the middle.
            newPdfManager!.terminate(
              new AbortException("Worker was terminated.")
            );
            throw new Error("Worker was terminated");
          }
          pdfManager = newPdfManager;

          pdfManager.requestLoadedStream(/* noFetch = */ true).then(stream => {
            handler!.send("DataLoaded", { length: stream.bytes.byteLength });
          });
        })
        .then(pdfManagerReady, onFailure);
    }

    handler.on("GetPage", function (data) {
      return pdfManager!.getPage(data.pageIndex).then(function (page) {
        return Promise.all([
          pdfManager!.ensure(page, "rotate"),
          pdfManager!.ensure(page, "ref"),
          pdfManager!.ensure(page, "userUnit"),
          pdfManager!.ensure(page, "view"),
        ]).then(function ([rotate, ref, userUnit, view]) {
          return {
            rotate,
            ref,
            refStr: ref?.toString() ?? null,
            userUnit,
            view,
          };
        });
      });
    });

    handler.on("GetPageIndex", function (data) {
      const pageRef = Ref.get(data.num, data.gen);
      return pdfManager!.ensureCatalog("getPageIndex", [pageRef]);
    });

    handler.on("GetDestinations", function () {
      return pdfManager!.ensureCatalog("destinations");
    });

    handler.on("GetDestination", function (data: { id: string }) {
      return pdfManager!.ensureCatalog("getDestination", [data.id]);
    });

    handler.on("GetPageLabels", function () {
      return pdfManager!.ensureCatalog("pageLabels");
    });

    handler.on("GetPageLayout", function () {
      return pdfManager!.ensureCatalog("pageLayout");
    });

    handler.on("GetPageMode", function () {
      return pdfManager!.ensureCatalog("pageMode");
    });

    handler.on("GetViewerPreferences", function () {
      return pdfManager!.ensureCatalog("viewerPreferences");
    });

    handler.on("GetOpenAction", function () {
      return pdfManager!.ensureCatalog("openAction");
    });

    handler.on("GetAttachments", function () {
      return pdfManager!.ensureCatalog("attachments");
    });

    handler.on("GetDocJSActions", function () {
      return pdfManager!.ensureCatalog("jsActions");
    });

    handler.on("GetPageJSActions", function ({ pageIndex }) {
      return pdfManager!.getPage(pageIndex).then(function (page) {
        return pdfManager!.ensure(page, "jsActions");
      });
    });

    handler.on("GetOutline", function () {
      return pdfManager!.ensureCatalog("documentOutline");
    });

    handler.on("GetOptionalContentConfig", function () {
      return pdfManager!.ensureCatalog("optionalContentConfig");
    });

    handler.on("GetPermissions", function () {
      return pdfManager!.ensureCatalog("permissions");
    });

    handler.on("GetMetadata", function () {
      return Promise.all([
        pdfManager!.ensureDoc("documentInfo"),
        pdfManager!.ensureCatalog("metadata"),
      ]);
    });

    handler.on("GetMarkInfo", function () {
      return pdfManager!.ensureCatalog("markInfo");
    });

    handler.on("GetData", function () {
      return pdfManager!.requestLoadedStream().then(function (stream) {
        return stream.bytes;
      });
    });

    handler.on("GetAnnotations", function ({ pageIndex, intent }: { pageIndex: number, intent: number }) {
      return pdfManager!.getPage(pageIndex).then(function (page) {
        const task = new WorkerTask(`GetAnnotations: page ${pageIndex}`);
        startWorkerTask(task);

        return page.getAnnotationsData(handler!, task, intent).then(
          data => {
            finishWorkerTask(task);
            return data;
          },
          reason => {
            finishWorkerTask(task);
            throw reason;
          }
        );
      });
    });

    handler.on("GetFieldObjects", function () {
      return pdfManager!.ensureDoc("fieldObjects")
        .then(fieldObjects => fieldObjects?.allFields || null);
    });

    handler.on("HasJSActions", function () {
      return pdfManager!.ensureDoc("hasJSActions");
    });

    handler.on("GetCalculationOrderIds", function () {
      return pdfManager!.ensureDoc("calculationOrderIds");
    });

    handler.on(
      "SaveDocument",
      async function ({ numPages, annotationStorage, filename }: SaveDocumentMessage) {
        const globalPromises = [
          pdfManager!.requestLoadedStream(),
          pdfManager!.ensureCatalog("acroForm") as Promise<Dict>,
          pdfManager!.ensureCatalog("acroFormRef") as Promise<Ref | null>,
          pdfManager!.ensureDoc("startXRef") as Promise<number>,
          pdfManager!.ensureDoc("xref") as Promise<XRef>,
          pdfManager!.ensureDoc("linearization") as Promise<LinearizationInterface | null>,
          pdfManager!.ensureCatalog("structTreeRoot") as Promise<StructTreeRoot | null>,
        ] as [
            Promise<Stream>, Promise<Dict>, Promise<Ref | null>, Promise<number>,
            Promise<XRef>, Promise<LinearizationInterface | null>, Promise<StructTreeRoot | null>
          ];
        const promises = <Promise<any>[]>[];

        const newAnnotationsByPage = getNewAnnotationsMap(annotationStorage)
        const [
          streamResult,
          acroForm,
          acroFormRef,
          startXRef,
          xrefResult,
          linearization,
          _structTreeRoot,
        ] = await Promise.all(globalPromises);
        const xref = <XRef>xrefResult;
        const stream = <Stream>streamResult;
        const catalogRef = xref.trailer!.getRaw(DictKey.Root) || null;
        let structTreeRoot: StructTreeRoot | null = null;

        if (newAnnotationsByPage) {
          if (!_structTreeRoot) {
            if (
              await StructTreeRoot.canCreateStructureTree({
                catalogRef,
                pdfManager: pdfManager!,
                newAnnotationsByPage,
              })
            ) {
              structTreeRoot = null;
            }
          } else if (
            await _structTreeRoot.canUpdateStructTree(
              pdfManager!,
              xref,
              newAnnotationsByPage,
            )
          ) {
            structTreeRoot = _structTreeRoot;
          }

          const imagePromises = AnnotationFactory.generateImages(
            annotationStorage!.values(),
            xref,
            pdfManager!.evaluatorOptions.isOffscreenCanvasSupported
          );
          const newAnnotationPromises =
            structTreeRoot === undefined ? promises : [];
          for (const [pageIndex, annotations] of newAnnotationsByPage) {
            newAnnotationPromises.push(
              pdfManager!.getPage(pageIndex).then(page => {
                const task = new WorkerTask(`Save (editor): page ${pageIndex}`);
                return page
                  .saveNewAnnotations(handler!, task, annotations, imagePromises)
                  .finally(function () {
                    finishWorkerTask(task);
                  });
              })
            );
          }
          if (structTreeRoot === null) {
            // No structTreeRoot exists, so we need to create one.
            promises.push(
              Promise.all(newAnnotationPromises).then(async newRefs => {
                await StructTreeRoot.createStructureTree(
                  newAnnotationsByPage,
                  xref,
                  catalogRef,
                  pdfManager!,
                  newRefs,
                );
                return newRefs;
              })
            );
          } else if (structTreeRoot) {
            promises.push(
              Promise.all(newAnnotationPromises).then(async newRefs => {
                await structTreeRoot!.updateStructureTree(
                  newAnnotationsByPage,
                  pdfManager!,
                  newRefs,
                );
                return newRefs;
              })
            );
          }
        }


        for (let pageIndex = 0; pageIndex < numPages!; pageIndex++) {
          promises.push(
            pdfManager!.getPage(pageIndex).then(async function (page) {
              const task = new WorkerTask(`Save: page ${pageIndex}`);
              return page
                .save(handler!, task, annotationStorage)
                .finally(function () {
                  finishWorkerTask(task);
                });
            })
          );
        }

        const refs = await Promise.all(promises);

        let newRefs = [];

        newRefs = refs.flat(2);

        if (newRefs.length === 0) {
          // No new refs so just return the initial bytes
          return stream.bytes;
        }

        // 这类加了 双感叹号，判断Ref状况
        const needAppearances: boolean = !!acroFormRef && acroForm instanceof Dict && newRefs.some(ref => ref.needAppearances);

        let newXrefInfo = Object.create(null);
        if (xref.trailer) {
          // Get string info from Info in order to compute fileId.
          const infoObj = Object.create(null) as Record<string, string>;
          const xrefInfo = xref.trailer.getValue(DictKey.Info) || null;
          if (xrefInfo instanceof Dict) {
            xrefInfo.forEach((key, value) => {
              if (typeof value === "string") {
                infoObj[key] = stringToPDFString(value);
              }
            });
          }

          newXrefInfo = {
            rootRef: catalogRef,
            encryptRef: xref.trailer.getRaw(DictKey.Encrypt) || null,
            newRef: xref.getNewTemporaryRef(),
            infoRef: xref.trailer.getRaw(DictKey.Info) || null,
            info: infoObj,
            fileIds: xref.trailer.getValue(DictKey.ID) || null,
            startXRef: linearization
              ? startXRef
              : (xref.lastXRefStreamPos ?? startXRef),
            filename,
          };
        }

        return incrementalUpdate({
          originalData: stream.bytes,
          xrefInfo: newXrefInfo,
          newRefs,
          xref,
          needAppearances,
          acroFormRef,
          acroForm,
          // Use the same kind of XRef as the previous one.
          useXrefStream: isDict(xref.topDict, "XRef"),
        }).finally(() => {
          xref.resetNewTemporaryRef();
        });
      }
    );

    handler.on("GetOperatorList", function (data: StreamGetOperatorListParameters, sink: StreamSink) {
      const pageIndex = data.pageIndex;
      pdfManager!.getPage(pageIndex).then(function (page) {
        const task = new WorkerTask(`GetOperatorList: page ${pageIndex}`);
        startWorkerTask(task);

        // NOTE: Keep this condition in sync with the `info` helper function.
        const start = verbosity >= VerbosityLevel.INFOS ? Date.now() : 0;

        // Pre compile the pdf page and fetch the fonts/images.
        page.getOperatorList(
          handler!, sink, task, data.intent, data.cacheKey,
          data.annotationStorage, data.modifiedIds
        ).then(
          function (operatorListInfo) {
            finishWorkerTask(task);

            if (start) {
              info(
                `page=${pageIndex + 1} - getOperatorList: time=` +
                `${Date.now() - start}ms, len=${operatorListInfo.length}`
              );
            }
            sink.close();
          },
          function (reason) {
            finishWorkerTask(task);
            if (task.terminated) {
              return; // ignoring errors from the terminated thread
            }
            sink.error(reason);

            // TODO: Should `reason` be re-thrown here (currently that casues
            //       "Uncaught exception: ..." messages in the console)?
          }
        );
      });
    });

    handler.on("GetTextContent", function (data, sink: StreamSink) {
      const { pageIndex, includeMarkedContent, disableNormalization } = data;

      pdfManager!.getPage(pageIndex).then(function (page) {
        const task = new WorkerTask("GetTextContent: page " + pageIndex);
        startWorkerTask(task);

        // NOTE: Keep this condition in sync with the `info` helper function.
        const start = verbosity >= VerbosityLevel.INFOS ? Date.now() : 0;

        page.extractTextContent(
          handler!, task, includeMarkedContent,
          disableNormalization, sink,
        ).then(
          function () {
            finishWorkerTask(task);

            if (start) {
              info(
                `page=${pageIndex + 1} - getTextContent: time=` +
                `${Date.now() - start}ms`
              );
            }
            sink.close();
          },
          function (reason) {
            finishWorkerTask(task);
            if (task.terminated) {
              return; // ignoring errors from the terminated thread
            }
            sink.error(reason);

            // TODO: Should `reason` be re-thrown here (currently that casues
            //       "Uncaught exception: ..." messages in the console)?
          }
        );
      });
    });

    handler.on("GetStructTree", function (data) {
      return pdfManager!.getPage(data.pageIndex).then(function (page) {
        return pdfManager!.ensure(page, "getStructTree");
      });
    });

    handler.on("FontFallback", function (data) {
      return pdfManager!.fontFallback(data.id, handler);
    });

    handler.on("Cleanup", function () {
      return pdfManager!.cleanup(/* manuallyTriggered = */ true);
    });

    handler.on("Terminate", function () {
      terminated = true;

      const waitOn = [];
      if (pdfManager) {
        pdfManager.terminate(new AbortException("Worker was terminated."));

        const cleanupPromise = pdfManager!.cleanup();
        waitOn.push(cleanupPromise);

        pdfManager = null;
      } else {
        clearGlobalCaches();
      }
      cancelXHRs?.(new AbortException("Worker was terminated."));

      for (const task of WorkerTasks) {
        waitOn.push(task.finished);
        task.terminate();
      }

      return Promise.all(waitOn).then(function () {
        // Notice that even if we destroying handler, resolved response promise
        // must be sent back.
        handler!.destroy();
        handler = null;
      });
    });

    handler.on("Ready", function (_data) {
      setupDoc(docParams!);
      docParams = null; // we don't need docParams anymore -- saving memory.
    });

    if (PlatformHelper.isTesting()) {
      handler.on("GetXRefPrevValue", function () {
        return pdfManager!.ensureXRef("trailer")
          .then(trailer => trailer.get("Prev"));
      });
      handler.on("GetStartXRefPos", function () {
        return pdfManager!.ensureDoc("startXRef");
      });
      handler.on("GetAnnotArray", function (data: { pageIndex: number }) {
        return pdfManager!.getPage(data.pageIndex).then(function (page) {
          return page.annotations.map(a => a.toString());
        });
      });
    }

    return workerHandlerName;
  }

  static initializeFromPort(port: Window & typeof globalThis) {
    const handler = new MessageHandler("worker", "main", port);
    WorkerMessageHandler.setup(handler, port);
    handler.send("ready", null);
  }
}

function isMessagePort(maybePort) {
  return (
    typeof maybePort.postMessage === "function" && "onmessage" in maybePort
  );
}

// Worker thread (and not Node.js)?
if (
  typeof window === "undefined" &&
  !isNodeJS &&
  typeof self !== "undefined" &&
  isMessagePort(self)
) {
  WorkerMessageHandler.initializeFromPort(self);
}

export { WorkerMessageHandler, WorkerTask };
