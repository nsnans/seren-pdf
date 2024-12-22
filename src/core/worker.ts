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

import { DocumentParameter } from "../display/api";
import { PlatformHelper } from "../platform/platform_helper";
import { MessageHandler } from "../shared/message_handler";
import { MessagePoster } from "../shared/message_handler_base";
import { GetDocMessage, SaveDocumentMessage } from "../shared/message_handler_types";
import {
  AbortException,
  assert,
  getVerbosityLevel,
  info,
  InvalidPDFException,
  MissingPDFException,
  PasswordException,
  setVerbosityLevel,
  stringToPDFString,
  UnexpectedResponseException,
  UnknownErrorException,
  VerbosityLevel,
  warn
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
  static setup(handler: MessageHandler, port: MessagePoster) {
    let testMessageProcessed = false;
    handler.onTest((data) => {
      if (testMessageProcessed) {
        return; // we already processed 'test' message once
      }
      testMessageProcessed = true;

      // Ensure that `TypedArray`s can be sent to the worker.
      handler.test(data instanceof Uint8Array);
    });

    handler.onConfigure((data) => setVerbosityLevel(data.verbosity));

    handler.onGetDocRequest((data) => WorkerMessageHandler.createDocumentHandler(data, port));
  }

  static createDocumentHandler(docParams: DocumentParameter | null, port: MessagePoster) {
    // This context is actually holds references on pdfManager and handler,
    // until the latter is destroyed.
    let pdfManager: PDFManager | null;
    let terminated = false;
    let cancelXHRs: ((reason: any) => void) | null = null;
    const WorkerTasks = new Set<WorkerTask>();
    const verbosity = getVerbosityLevel();

    const { docId, apiVersion } = docParams!;
    const workerVersion = PlatformHelper.bundleVersion();
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
        const errorText = "The `Array.prototype` contains unexpected enumerable properties: " +
          enumerableProperties.join(", ") +
          "; thus breaking e.g. `for...in` iteration of `Array`s."
        throw new Error(errorText);
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

      await pdfManager!.ensureDoc(doc => doc.checkHeader());
      await pdfManager!.ensureDoc(doc => doc.parseStartXRef());
      await pdfManager!.ensureDoc(doc => doc.parse(recoveryMode));

      // Check that at least the first page can be successfully loaded,
      // since otherwise the XRef table is definitely not valid.
      await pdfManager!.ensureDoc(doc => doc.checkFirstPage(recoveryMode));

      // Check that the last page can be successfully loaded, to ensure that
      // `numPages` is correct, and fallback to walking the entire /Pages-tree.
      await pdfManager!.ensureDoc(doc => doc.checkLastPage(recoveryMode));

      const [numPages, fingerprints] = await Promise.all([
        pdfManager!.ensureDoc(doc => doc.numPages),
        pdfManager!.ensureDoc(doc => doc.fingerprints),
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
    }: DocumentParameter): Promise<PDFManager> {
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
              handler!.DocProgress(loaded, Math.max(loaded, fullRequest.contentLength || 0));
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

    function setupDoc(data: DocumentParameter) {
      function onSuccess(doc: GetDocMessage) {
        ensureNotTerminated();
        handler!.GetDoc(doc.numPages, doc.fingerprints);
      }

      function onFailure(ex: any) {
        ensureNotTerminated();
        if (ex instanceof PasswordException) {
          const task = new WorkerTask(`PasswordException: response ${ex.code}`);
          startWorkerTask(task);

          handler!.PasswordRequest(ex).then(({ password }) => {
            finishWorkerTask(task);
            pdfManager!.updatePassword(password);
            pdfManagerReady();
          }).catch(() => {
            finishWorkerTask(task);
            handler!.DocException(ex);
          });
        } else if (
          ex instanceof InvalidPDFException ||
          ex instanceof MissingPDFException ||
          ex instanceof UnexpectedResponseException ||
          ex instanceof UnknownErrorException
        ) {
          handler!.DocException(ex);
        } else {
          handler!.DocException(new UnknownErrorException(ex.message, ex.toString()));
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

      getPdfManager(data).then(function (newPdfManager: PDFManager) {
        if (terminated) {
          // We were in a process of setting up the manager, but it got
          // terminated in the middle.
          newPdfManager!.terminate(new AbortException("Worker was terminated."));
          throw new Error("Worker was terminated");
        }
        pdfManager = newPdfManager;

        pdfManager.requestLoadedStream(/* noFetch = */ true).then(
          stream => handler!.DataLoaded(stream.bytes.byteLength)
        );
      }).then(pdfManagerReady, onFailure);
    }

    handler.onGetPage(async data => {
      return pdfManager!.getPage(data.pageIndex).then(async page => {
        return Promise.all([
          pdfManager!.ensure(page, page => page.rotate),
          pdfManager!.ensure(page, page => page.ref),
          pdfManager!.ensure(page, page => page.userUnit),
          pdfManager!.ensure(page, page => page.view),
        ]).then(function ([rotate, ref, userUnit, view]) {
          return { rotate, ref, refStr: ref?.toString() ?? null, userUnit, view };
        });
      });
    });

    handler.onGetPageIndex((data) => {
      const pageRef = Ref.get(data.num, data.gen);
      return pdfManager!.ensureCatalog(catalog => catalog.getPageIndex(pageRef));
    });

    handler.onGetDestinations(
      () => pdfManager!.ensureCatalog(catalog => catalog.destinations)
    );

    handler.onGetDestination(
      data => pdfManager!.ensureCatalog(catalog => catalog.getDestination(data.id))
    );

    handler.onGetPageLabels(
      () => pdfManager!.ensureCatalog(catalog => catalog.pageLabels)
    );

    handler.onGetPageLayout(
      () => pdfManager!.ensureCatalog(catalog => catalog.pageLayout)
    );

    handler.onGetPageMode(
      () => pdfManager!.ensureCatalog(catalog => catalog.pageMode)
    );

    handler.onGetViewerPreferences(
      () => pdfManager!.ensureCatalog(catalog => catalog.viewerPreferences)
    );

    handler.on("GetOpenAction", function () {
      return pdfManager!.ensureCatalog(catalog => catalog.openAction);
    });

    handler.onGetAttachments(
      () => pdfManager!.ensureCatalog(catalog => catalog.attachments)
    );

    handler.onGetDocJSActions(
      () => pdfManager!.ensureCatalog(catalog => catalog.jsActions)
    );

    handler.onGetPageJSActions(
      data => pdfManager!.getPage(data.pageIndex).then(
        page => pdfManager!.ensure(page, page => page.jsActions)
      )
    );

    handler.on("GetOutline", function () {
      return pdfManager!.ensureCatalog(catalog => catalog.documentOutline);
    });

    handler.on("GetOptionalContentConfig", function () {
      return pdfManager!.ensureCatalog(catalog => catalog.optionalContentConfig);
    });

    handler.onGetPermissions(
      () => pdfManager!.ensureCatalog(catalog => catalog.permissions)
    );

    handler.on("GetMetadata", function () {
      return Promise.all([
        pdfManager!.ensureDoc(doc => doc.documentInfo),
        pdfManager!.ensureCatalog(catalog => catalog.metadata),
      ]);
    });

    handler.onGetMarkInfo(
      () => pdfManager!.ensureCatalog(catalog => catalog.markInfo)
    );

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
      return pdfManager!.ensureDoc(doc => doc.fieldObjects)
        .then(fieldObjects => fieldObjects?.allFields || null);
    });

    handler.on("HasJSActions", function () {
      return pdfManager!.ensureDoc(doc => doc.hasJSActions);
    });

    handler.on("GetCalculationOrderIds", function () {
      return pdfManager!.ensureDoc(doc => doc.calculationOrderIds);
    });

    handler.on(
      "SaveDocument",
      async function ({ numPages, annotationStorage, filename }: SaveDocumentMessage) {
        const globalPromises = [
          pdfManager!.requestLoadedStream(),
          pdfManager!.ensureCatalog(catalog => catalog.acroForm),
          pdfManager!.ensureCatalog(catalog => catalog.acroFormRef),
          pdfManager!.ensureDoc(doc => doc.startXRef),
          pdfManager!.ensureDoc(doc => doc.xref),
          pdfManager!.ensureDoc(doc => doc.linearization),
          pdfManager!.ensureCatalog(catalog => catalog.structTreeRoot),
        ] as const;
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
        return pdfManager!.ensure(page, page => page.getStructTree());
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

    handler.onReady(() => {
      setupDoc(docParams!);
      docParams = null; // we don't need docParams anymore -- saving memory.
    });

    if (PlatformHelper.isTesting()) {
      handler.on("GetXRefPrevValue", async () => pdfManager!.ensureXRef(xref => xref.trailer)
        .then(trailer => trailer!.get(DictKey.Prev))
      );
      handler.on("GetStartXRefPos", function () {
        return pdfManager!.ensureDoc(doc => doc.startXRef);
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
    const handler = new MessageHandler("worker", "main", <any>port);
    WorkerMessageHandler.setup(handler, port);
    handler.send("ready", null);
  }
}

function isMessagePort(maybePort: typeof self) {
  return (
    typeof maybePort.postMessage === "function" && "onmessage" in maybePort
  );
}

// Worker thread (and not Node.js)?
if (typeof window === "undefined" && typeof self !== "undefined" && isMessagePort(self)) {
  WorkerMessageHandler.initializeFromPort(self);
}

export { WorkerMessageHandler, WorkerTask };
