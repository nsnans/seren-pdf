import { CommonObjType, ObjType } from "../shared/message_handler";
import { warn, assert, OPS } from "../shared/util";
import { BaseStream } from "./base_stream";
import { ImageMask, SingleOpaquePixelImageMask, SMaskOptions } from "./core_types";
import { DecodeStream } from "./decode_stream";
import { EvaluatorContext, StateManager } from "./evaluator";
import { EvaluatorBaseHandler } from "./evaluator_base";
import { isPDFFunction } from "./function";
import { PDFImage } from "./image";
import { GlobalImageCacheData, ImageCacheData, LocalColorSpaceCache, LocalImageCache, OptionalContent } from "./image_utils";
import { OperatorList } from "./operator_list";
import { Dict, DictKey } from "./primitives";
import { WorkerTask } from "./worker";

export class EvaluatorImageHandler extends EvaluatorBaseHandler {

  constructor(context: EvaluatorContext) {
    super(context);
  }

  _sendImgData(objId: string, imgData: ImageMask | null, cacheGlobally = false) {
    const transfers = imgData ? [imgData.bitmap || imgData.data!.buffer] : null;
    if (this.context.parsingType3Font || cacheGlobally) {
      return this.context.handler.commonobj(objId, CommonObjType.Image, imgData, transfers);
    }
    return this.context.handler.obj(objId, this.context.pageIndex, ObjType.Image, imgData, transfers);
  }

  async buildPaintImageXObject(
    resources: Dict,
    image: BaseStream,
    isInline: boolean,
    operatorList: OperatorList,
    cacheKey: string | null,
    localImageCache: LocalImageCache,
    localColorSpaceCache: LocalColorSpaceCache
  ) {
    const dict = image.dict!;
    const imageRef = dict.objId;
    const w = dict.getValueWithFallback(DictKey.W, DictKey.Width);
    const h = dict.getValueWithFallback(DictKey.H, DictKey.Height);

    if (!(w && typeof w === "number") || !(h && typeof h === "number")) {
      warn("Image dimensions are missing, or not numbers.");
      return;
    }
    const maxImageSize = this.context.options.maxImageSize;
    if (maxImageSize !== -1 && w * h > maxImageSize) {
      const msg = "Image exceeded maximum allowed size and was removed.";
      if (this.context.options.ignoreErrors) {
        warn(msg);
        return;
      }
      throw new Error(msg);
    }

    let optionalContent = null;
    if (dict.has(DictKey.OC)) {
      optionalContent = await this.parseMarkedContentProps(
        dict.getValue(DictKey.OC), resources
      );
    }

    const imageMask = dict.getValueWithFallback(DictKey.IM, DictKey.ImageMask) || false;
    let imgData: ImageMask, args;
    if (imageMask) {
      // This depends on a tmpCanvas being filled with the current fillStyle,
      // such that processing the pixel data can't be done here. 
      // Instead of creating a complete PDFImage, only read the information needed for later.
      const interpolate = dict.getValueWithFallback(DictKey.I, DictKey.Interpolate);
      const bitStrideLength = (w + 7) >> 3;
      const imgArray = image.getBytes(bitStrideLength * h);
      const decode = <number[]>dict.getArrayWithFallback(DictKey.D, DictKey.Decode);

      if (this.context.parsingType3Font) {
        imgData = PDFImage.createRawMask(
          imgArray, w, h, image instanceof DecodeStream, decode?.[0] > 0, interpolate
        );

        imgData.cached = !!cacheKey;
        args = [imgData];

        operatorList.addImageOps(
          OPS.paintImageMaskXObject, <[ImageMask]>args, <OptionalContent | null>optionalContent
        );

        if (cacheKey) {
          const cacheData = {
            fn: OPS.paintImageMaskXObject, args, optionalContent,
          };
          localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

          if (imageRef) {
            this.context.regionalImageCache.set(
              null, imageRef, <ImageCacheData>cacheData
            );
          }
        }
        return;
      }

      const result = await PDFImage.createMask(
        <Uint8Array<ArrayBuffer>>imgArray, w, h, image instanceof DecodeStream,
        decode?.[0] > 0, interpolate, this.context.options.isOffscreenCanvasSupported,
      );

      if ((<SingleOpaquePixelImageMask>result).isSingleOpaquePixel) {
        // Handles special case of mainly LaTeX documents which use image
        // masks to draw lines with the current fill style.
        operatorList.addImageOps(
          OPS.paintSolidColorImageMask, [], optionalContent
        );

        if (cacheKey) {
          const cacheData = {
            fn: OPS.paintSolidColorImageMask, args: [], optionalContent,
          };
          localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

          if (imageRef) {
            this.context.regionalImageCache.set(
              null, imageRef, <ImageCacheData>cacheData
            );
          }
        }
        return;
      }

      imgData = <ImageMask>result;

      const objId = `mask_${this.context.idFactory.createObjId()}`;
      operatorList.addDependency(objId);
      imgData.dataLen = imgData.bitmap ? imgData.width * imgData.height * 4 : imgData.data!.length;
      this._sendImgData(objId, imgData);

      args = [{
        data: objId,
        width: imgData.width,
        height: imgData.height,
        interpolate: imgData.interpolate,
        count: 1,
      }];
      operatorList.addImageOps(OPS.paintImageMaskXObject, args, optionalContent);

      if (cacheKey) {
        const cacheData = {
          objId, fn: OPS.paintImageMaskXObject, args, optionalContent,
        };
        localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

        if (imageRef) {
          this.context.regionalImageCache.set(null, imageRef, <ImageCacheData>cacheData);
        }
      }
      return;
    }

    const SMALL_IMAGE_DIMENSIONS = 200;
    // Inlining small images into the queue as RGB data
    if (
      isInline && w + h < SMALL_IMAGE_DIMENSIONS && !dict.has(DictKey.SMask) && !dict.has(DictKey.Mask)
    ) {
      try {
        const imageObj = new PDFImage(
          this.context.xref, resources, image, isInline, null,
          null, false, this.context.pdfFunctionFactory, localColorSpaceCache,
        );
        // We force the use of RGBA_32BPP images here, because we can't handle
        // any other kind.
        imgData = await imageObj.createImageData(true, false);
        operatorList.isOffscreenCanvasSupported = this.context.options.isOffscreenCanvasSupported;
        operatorList.addImageOps(OPS.paintInlineImageXObject, [imgData], optionalContent);
      } catch (reason) {
        const msg = `Unable to decode inline image: "${reason}".`;

        if (!this.context.options.ignoreErrors) {
          throw new Error(msg);
        }
        warn(msg);
      }
      return;
    }

    // If there is no imageMask, create the PDFImage and a lot
    // of image processing can be done here.
    let objId = `img_${this.context.idFactory.createObjId()}`;
    let cacheGlobally = false;

    if (this.context.parsingType3Font) {
      objId = `${this.context.idFactory.getDocId()}_type3_${objId}`;
    } else if (cacheKey && imageRef) {
      cacheGlobally = this.context.globalImageCache.shouldCache(imageRef, this.context.pageIndex);

      if (cacheGlobally) {
        assert(!isInline, "Cannot cache an inline image globally.");
        objId = `${this.context.idFactory.getDocId()}_${objId}`;
      }
    }

    // Ensure that the dependency is added before the image is decoded.
    operatorList.addDependency(objId);
    args = <[string, number, number]>[objId, w, h];
    operatorList.addImageOps(OPS.paintImageXObject, args, optionalContent);

    if (cacheGlobally) {
      if (this.context.globalImageCache.hasDecodeFailed(imageRef!)) {
        this.context.globalImageCache.setData(imageRef!, <GlobalImageCacheData>{
          objId, fn: OPS.paintImageXObject, args, optionalContent,
          byteSize: 0, // Data is `null`, since decoding failed previously.
        });

        this._sendImgData(objId, /* imgData = */ null, cacheGlobally);
        return;
      }

      // For large (at least 500x500) or more complex images that we'll cache
      // globally, check if the image is still cached locally on the main-thread
      // to avoid having to re-parse the image (since that can be slow).
      if (w * h > 250000 || dict.has(DictKey.SMask) || dict.has(DictKey.Mask)) {

        const handler = this.context.handler;
        const localLength = await handler.commonobjPromise(
          objId, CommonObjType.CopyLocalImage, { imageRef: imageRef! }
        );

        if (localLength) {
          this.context.globalImageCache.setData(imageRef!, <GlobalImageCacheData>{
            objId, fn: OPS.paintImageXObject, args, optionalContent,
            byteSize: 0, // Temporary entry, to avoid `setData` returning early.
          });
          this.context.globalImageCache.addByteSize(imageRef!, localLength);
          return;
        }
      }
    }

    PDFImage.buildImage(
      this.context.xref, resources, image, isInline, this.context.pdfFunctionFactory, localColorSpaceCache,
    ).then(async imageObj => {
      imgData = await imageObj.createImageData(false, this.context.options.isOffscreenCanvasSupported);
      imgData.dataLen = imgData.bitmap ? imgData.width * imgData.height * 4 : imgData.data!.length;
      imgData.ref = imageRef;

      if (cacheGlobally) {
        this.context.globalImageCache.addByteSize(imageRef!, imgData.dataLen);
      }
      return this._sendImgData(objId, imgData, cacheGlobally);
    }).catch(reason => {
      warn(`Unable to decode image "${objId}": "${reason}".`);
      if (imageRef) {
        this.context.globalImageCache.addDecodeFailed(imageRef);
      }
      return this._sendImgData(objId, null, cacheGlobally);
    });

    if (cacheKey) {
      const cacheData = {
        objId, fn: OPS.paintImageXObject, args, optionalContent
      };
      localImageCache.set(cacheKey, imageRef, <ImageCacheData>cacheData);

      if (imageRef) {
        this.context.regionalImageCache.set(null, imageRef, <ImageCacheData>cacheData);

        if (cacheGlobally) {
          this.context.globalImageCache.setData(imageRef!, <GlobalImageCacheData>{
            objId, fn: OPS.paintImageXObject, args, optionalContent,
            byteSize: 0, // Temporary entry, note `addByteSize` above.
          });
        }
      }
    }
  }

  handleSMask(
    smask: Dict, resources: Dict, operatorList: OperatorList, task: WorkerTask,
    stateManager: StateManager, localColorSpaceCache: LocalColorSpaceCache
  ) {
    const smaskContent = smask.getValue(DictKey.G);
    const smaskOptions: SMaskOptions = {
      subtype: smask.getValue(DictKey.S).name,
      backdrop: smask.getValue(DictKey.BC),
    };

    // The SMask might have a alpha/luminosity value transfer function --
    // we will build a map of integer values in range 0..255 to be fast.
    const transferObj = smask.getValue(DictKey.TR);
    if (isPDFFunction(transferObj)) {
      const transferFn = this.context.pdfFunctionFactory.create(transferObj);
      const transferMap = new Uint8Array(256);
      const tmp = new Float32Array(1);
      for (let i = 0; i < 256; i++) {
        tmp[0] = i / 255;
        transferFn(tmp, 0, tmp, 0);
        transferMap[i] = (tmp[0] * 255) | 0;
      }
      smaskOptions.transferMap = transferMap;
    }

    return this.context.generalHandler.buildFormXObject(
      resources, smaskContent, smaskOptions, operatorList,
      task, stateManager.state.clone(), localColorSpaceCache
    );
  }
}
