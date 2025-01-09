import { RectType, TransformType } from "../display/display_utils";
import { FormatError, info, OPS, TextRenderingMode, warn } from "../shared/util";
import { BaseStream } from "./base_stream";
import { ColorSpace } from "./colorspace";
import { lookupMatrix, lookupNormalRect } from "./core_utils";
import { EvaluatorContext, normalizeBlendMode, PartialEvaluator, State, StateManager } from "./evaluator";
import { EvaluatorColorHandler } from "./evaluator_color_handler";
import { EvaluatorFontHandler } from "./evaluator_font_handler";
import { EvaluatorImageHandler } from "./evaluator_image_handler";
import { OPSProcessContext } from "./evaluator_general_operator";
import { isPDFFunction } from "./function";
import { GroupOptions, LocalColorSpaceCache, LocalGStateCache, OptionalContent } from "./image_utils";
import { OperatorList } from "./operator_list";
import { Dict, RefSet, DictKey, Ref, Name, isName } from "./primitives";
import { WorkerTask } from "./worker";

/**
 * {@link EvaluatorFontHandler} 管理了处理字体逻辑相关的方法。
 * {@link EvaluatorColorHandler} 管理了处理色彩逻辑相关的方法。
 * {@link EvaluatorImageHandler} 管理了处理图片逻辑相关的方法。
 * 该类则管理剩余相关处理逻辑的方法。
 * 上述提到的所有类，都应该只有处理方法，不存储任何私有变量和状态信息。
 * 状态信息统一使用Context来进行管理。修改也是同一修改全局的Context。
 */
export class EvaluatorGeneralHandler {

  protected readonly context: EvaluatorContext;

  constructor(context: EvaluatorContext) {
    this.context = context;
  }

  async fetchBuiltInCMap(name: string) {
    const cachedData = this.context.builtInCMapCache.get(name);
    if (cachedData) {
      return cachedData;
    }
    let data: { cMapData: Uint8Array<ArrayBuffer>; isCompressed: boolean; };

    if (this.context.options.cMapUrl !== null) {
      // Only compressed CMaps are (currently) supported here.
      const url = `${this.context.options.cMapUrl}${name}.bcmap`;
      const response = await fetch(url);

      if (!response.ok) {
        const error = `fetchBuiltInCMap: failed to fetch file "${url}" with "${response.statusText}".`
        throw new Error(error);
      }
      data = {
        cMapData: new Uint8Array(await response.arrayBuffer()),
        isCompressed: true,
      };
    } else {
      // Get the data on the main-thread instead.
      data = await this.context.handler.FetchBuiltInCMap(name);
    }
    // Cache the CMap data, to avoid fetching it repeatedly.
    this.context.builtInCMapCache.set(name, data);

    return data;
  }

  // 这里应该必须是Dict类型，如果有其它类型可以在这里看看
  hasBlendModes(resources: Dict, nonBlendModesSet: RefSet) {
    if (!(resources instanceof Dict)) {
      return false;
    }
    if (resources.objId && nonBlendModesSet.has(resources.objId)) {
      return false;
    }

    const processed = new RefSet(nonBlendModesSet);
    if (resources.objId) {
      processed.put(resources.objId);
    }

    const nodes = [resources];
    const xref = this.context.xref;
    while (nodes.length) {
      const node = nodes.shift();
      // First check the current resources for blend modes.
      const graphicStates = node!.getValue(DictKey.ExtGState);
      if (graphicStates instanceof Dict) {
        for (let graphicState of graphicStates.getRawValues()) {
          if (graphicState instanceof Ref) {
            if (processed.has(graphicState)) {
              continue; // The ExtGState has already been processed.
            }
            try {
              graphicState = xref.fetch(graphicState);
            } catch (ex) {
              // Avoid parsing a corrupt ExtGState more than once.
              processed.put(graphicState);
              info(`hasBlendModes - ignoring ExtGState: "${ex}".`);
              continue;
            }
          }
          if (!(graphicState instanceof Dict)) {
            continue;
          }
          if (graphicState.objId) {
            processed.put(graphicState.objId);
          }

          const bm = graphicState.getValue(DictKey.BM);
          if (bm instanceof Name) {
            if (bm.name !== "Normal") {
              return true;
            }
            continue;
          }
          if (bm !== undefined && Array.isArray(bm)) {
            for (const element of bm) {
              if (element instanceof Name && element.name !== "Normal") {
                return true;
              }
            }
          }
        }
      }
      // Descend into the XObjects to look for more resources and blend modes.
      const xObjects = node!.getValue(DictKey.XObject);
      if (!(xObjects instanceof Dict)) {
        continue;
      }
      for (let xObject of xObjects.getRawValues()) {
        if (xObject instanceof Ref) {
          if (processed.has(xObject)) {
            // The XObject has already been processed, and by avoiding a
            // redundant `xref.fetch` we can *significantly* reduce the load
            // time for badly generated PDF files (fixes issue6961.pdf).
            continue;
          }
          try {
            xObject = xref.fetch(xObject);
          } catch (ex) {
            // Avoid parsing a corrupt XObject more than once.
            processed.put(xObject);
            info(`hasBlendModes - ignoring XObject: "${ex}".`);
            continue;
          }
        }
        if (!(xObject instanceof BaseStream)) {
          continue;
        }
        if (xObject.dict!.objId) {
          processed.put(xObject.dict!.objId);
        }
        const xResources = xObject.dict!.getValue(DictKey.Resources);
        if (!(xResources instanceof Dict)) {
          continue;
        }
        // Checking objId to detect an infinite loop.
        if (xResources.objId && processed.has(xResources.objId)) {
          continue;
        }

        nodes.push(xResources);
        if (xResources.objId) {
          processed.put(xResources.objId);
        }
      }
    }

    // When no blend modes exist, there's no need re-fetch/re-parse any of the
    // processed `Ref`s again for subsequent pages. This helps reduce redundant
    // `XRef.fetch` calls for some documents (e.g. issue6961.pdf).
    for (const ref of processed) {
      nonBlendModesSet.put(ref);
    }
    return false;
  }

  async buildFormXObject(ctx: OPSProcessContext) {
    const dict = xobj.dict!;
    const matrix = <TransformType | null>lookupMatrix(dict.getArrayValue(DictKey.Matrix), null);
    const bbox = lookupNormalRect(dict.getArrayValue(DictKey.BBox), null);

    let optionalContent, groupOptions: GroupOptions | null = null;
    if (dict.has(DictKey.OC)) {
      optionalContent = await this.parseMarkedContentProps(
        dict.getValue(DictKey.OC), ctx.resources
      );
    }
    if (optionalContent !== undefined) {
      ctx.operatorList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    const group = dict.getValue(DictKey.Group);
    if (group) {
      groupOptions = {
        matrix, bbox, smask, isolated: false, knockout: false
      };

      const groupSubtype = group.get(DictKey.S);
      let colorSpace = null;
      if (isName(groupSubtype, "Transparency")) {
        groupOptions!.isolated = group.get(DictKey.I) || false;
        groupOptions!.knockout = group.get(DictKey.K) || false;
        if (group.has(DictKey.CS)) {
          const cs = group.getRaw(DictKey.CS);

          const cachedColorSpace = ColorSpace.getCached(
            cs, ctx.xref, ctx.localColorSpaceCache
          );
          if (cachedColorSpace) {
            colorSpace = cachedColorSpace;
          } else {
            colorSpace = await this.context.colorHandler.parseColorSpace(
              cs, ctx.resources, ctx.localColorSpaceCache,
            );
          }
        }
      }

      if (smask?.backdrop) {
        colorSpace ||= ColorSpace.singletons.rgb;
        smask.backdrop = colorSpace.getRgb(smask.backdrop, 0);
      }

      ctx.operatorList.addOp(OPS.beginGroup, [groupOptions]);
    }

    // If it's a group, a new canvas will be created that is the size of the
    // bounding box and translated to the correct position so we don't need to
    // apply the bounding box to it.
    const args: [TransformType | null, RectType | null] = group ? [matrix, null] : [matrix, bbox];
    ctx.operatorList.addOp(OPS.paintFormXObjectBegin, args);

    await ctx.handle();
    ctx.operatorList.addOp(OPS.paintFormXObjectEnd, []);

    if (group) {
      ctx.operatorList.addOp(OPS.endGroup, [groupOptions!]);
    }

    if (optionalContent !== undefined) {
      ctx.operatorList.addOp(OPS.endMarkedContent, []);
    }
  }

  async parseMarkedContentProps(
    contentProperties: Name | Dict, resources: Dict | null
  ): Promise<OptionalContent | null> {
    let optionalContent: Dict;
    if (contentProperties instanceof Name) {
      const properties = resources!.getValue(DictKey.Properties);
      optionalContent = properties.get(<DictKey>contentProperties.name);
    } else if (contentProperties instanceof Dict) {
      optionalContent = contentProperties;
    } else {
      throw new FormatError("Optional content properties malformed.");
    }

    const optionalContentType = optionalContent.get(DictKey.Type)?.name;
    if (optionalContentType === "OCG") {
      return {
        type: optionalContentType,
        id: optionalContent.objId,
      };
    } else if (optionalContentType === "OCMD") {
      const expression = optionalContent.get(DictKey.VE);
      if (Array.isArray(expression)) {
        const result = [] as (string | string[])[];
        this._parseVisibilityExpression(expression, 0, result);
        if (result.length > 0) {
          return {
            type: "OCMD",
            expression: result,
          };
        }
      }

      const optionalContentGroups = optionalContent.get(DictKey.OCGs);
      if (
        Array.isArray(optionalContentGroups) ||
        optionalContentGroups instanceof Dict
      ) {
        const groupIds: (string | null)[] = [];
        if (Array.isArray(optionalContentGroups)) {
          for (const ocg of optionalContentGroups) {
            groupIds.push(ocg.toString());
          }
        } else {
          // Dictionary, just use the obj id.
          groupIds.push(optionalContentGroups.objId);
        }

        return {
          type: optionalContentType,
          ids: groupIds,
          policy: optionalContent.get(DictKey.P) instanceof Name
            ? optionalContent.get(DictKey.P).name : null,
          expression: null,
        };
      } else if (optionalContentGroups instanceof Ref) {
        return {
          type: optionalContentType,
          id: optionalContentGroups.toString(),
        };
      }
    }
    return null;
  }

  _parseVisibilityExpression(
    array: any[], nestingCounter: number, currentResult: (string | string[])[]
  ) {
    const MAX_NESTING = 10;
    if (++nestingCounter > MAX_NESTING) {
      warn("Visibility expression is too deeply nested");
      return;
    }
    const length = array.length;
    const operator = this.context.xref.fetchIfRef(array[0]);
    if (length < 2 || !(operator instanceof Name)) {
      warn("Invalid visibility expression");
      return;
    }
    switch (operator.name) {
      case "And":
      case "Or":
      case "Not":
        currentResult.push(operator.name);
        break;
      default:
        warn(`Invalid operator ${operator.name} in visibility expression`);
        return;
    }
    for (let i = 1; i < length; i++) {
      const raw = array[i];
      const object = this.context.xref.fetchIfRef(raw);
      if (Array.isArray(object)) {
        const nestedResult = <string[]>[];
        currentResult.push(nestedResult);
        // Recursively parse a subarray.
        this._parseVisibilityExpression(object, nestingCounter, nestedResult);
      } else if (raw instanceof Ref) {
        // Reference to an OCG dictionary.
        currentResult.push(raw.toString());
      }
    }
  }

  buildPath(operatorList: OperatorList, fn: OPS, args: number[], parsingText = false) {
    const lastIndex = operatorList.length - 1;
    if (!args) {
      args = [];
    }
    if (lastIndex < 0 || operatorList.fnArray[lastIndex] !== OPS.constructPath) {
      // Handle corrupt PDF documents that contains path operators inside of
      // text objects, which may shift subsequent text, by enclosing the path
      // operator in save/restore operators (fixes issue10542_reduced.pdf).
      //
      // Note that this will effectively disable the optimization in the
      // `else` branch below, but given that this type of corruption is
      // *extremely* rare that shouldn't really matter much in practice.
      if (parsingText) {
        warn(`Encountered path operator "${fn}" inside of a text object.`);
        operatorList.addOp(OPS.save, null);
      }

      let minMax: RectType;
      switch (fn) {
        case OPS.rectangle:
          const x = args[0] + args[2];
          const y = args[1] + args[3];
          minMax = [
            Math.min(args[0], x),
            Math.min(args[1], y),
            Math.max(args[0], x),
            Math.max(args[1], y),
          ];
          break;
        case OPS.moveTo:
        case OPS.lineTo:
          minMax = [args[0], args[1], args[0], args[1]];
          break;
        default:
          minMax = [Infinity, Infinity, -Infinity, -Infinity];
          break;
      }
      operatorList.addOp(OPS.constructPath, [[fn], args, minMax]);

      if (parsingText) {
        operatorList.addOp(OPS.restore, null);
      }
    } else {
      const opArgs = operatorList.argsArray[lastIndex]!;
      opArgs[0].push(fn);
      opArgs[1].push(...args);
      const minMax = opArgs[2];

      // Compute min/max in the worker instead of the main thread.
      // If the current matrix (when drawing) is a scaling one
      // then min/max can be easily computed in using those values.
      // Only rectangle, lineTo and moveTo are handled here since
      // Bezier stuff requires to have the starting point.
      switch (fn) {
        case OPS.rectangle:
          const x = args[0] + args[2];
          const y = args[1] + args[3];
          minMax[0] = Math.min(minMax[0], args[0], x);
          minMax[1] = Math.min(minMax[1], args[1], y);
          minMax[2] = Math.max(minMax[2], args[0], x);
          minMax[3] = Math.max(minMax[3], args[1], y);
          break;
        case OPS.moveTo:
        case OPS.lineTo:
          minMax[0] = Math.min(minMax[0], args[0]);
          minMax[1] = Math.min(minMax[1], args[1]);
          minMax[2] = Math.max(minMax[2], args[0]);
          minMax[3] = Math.max(minMax[3], args[1]);
          break;
      }
    }
  }

  async setGState(
    resources: Dict,
    gState: Dict,
    operatorList: OperatorList,
    cacheKey: string | null,
    task: WorkerTask,
    stateManager: StateManager,
    localGStateCache: LocalGStateCache,
    localColorSpaceCache: LocalColorSpaceCache
  ) {
    const gStateRef = gState.objId;
    let isSimpleGState = true;
    // This array holds the converted/processed state data.
    const gStateObj = <[DictKey, any][]>[];
    let promise = Promise.resolve();
    for (const key of gState.getKeys()) {
      const value = gState.getValue(key);
      switch (key) {
        case DictKey.Type:
          break;
        case DictKey.LW:
        case DictKey.LC:
        case DictKey.LJ:
        case DictKey.ML:
        case DictKey.D:
        case DictKey.RI:
        case DictKey.FL:
        case DictKey.CA:
        case DictKey.ca:
          gStateObj.push([key, value]);
          break;
        case DictKey.Font:
          isSimpleGState = false;
          promise = promise.then(() =>
            this.context.fontHandler.handleSetFont(
              resources, null, (<(Ref | null)[]>value)[0],
              operatorList, task, stateManager.state
            ).then(loadedName => {
              operatorList.addDependency(loadedName);
              gStateObj.push([key, [loadedName, (<Dict[]>value)[1]]]);
            })
          );
          break;
        case DictKey.BM:
          gStateObj.push([key, normalizeBlendMode(<Name>value)]);
          break;
        case "SMask":
          if (isName(value, "None")) {
            gStateObj.push([key, false]);
            break;
          }
          if (value instanceof Dict) {
            isSimpleGState = false;
            promise = promise.then(() =>
              this.context.imageHandler.handleSMask(
                value, resources, operatorList, task, stateManager, localColorSpaceCache
              )
            );
            gStateObj.push([key, true]);
          } else {
            warn("Unsupported SMask type");
          }
          break;
        case DictKey.TR:
          const transferMaps = this.handleTransferFunction(<Dict | BaseStream>value);
          gStateObj.push([key, transferMaps]);
          break;
        // Only generate info log messages for the following since
        // they are unlikely to have a big impact on the rendering.
        case DictKey.OP:
        case DictKey.op:
        case DictKey.OPM:
        case DictKey.BG:
        case DictKey.BG2:
        case DictKey.UCR:
        case DictKey.UCR2:
        case DictKey.TR2:
        case DictKey.HT:
        case DictKey.SM:
        case DictKey.SA:
        case DictKey.AIS:
        case DictKey.TK:
          // TODO implement these operators.
          info("graphic state operator " + key);
          break;
        default:
          info("Unknown graphic state operator " + key);
          break;
      }
    }
    await promise;

    if (gStateObj.length > 0) {
      operatorList.addOp(OPS.setGState, [gStateObj]);
    }

    if (isSimpleGState) {
      localGStateCache.set(cacheKey!, gStateRef!, gStateObj);
    }
  }

  handleTransferFunction(tr: Dict | BaseStream | (Dict | BaseStream)[]) {
    let transferArray;
    if (Array.isArray(tr)) {
      transferArray = tr;
    } else if (isPDFFunction(tr)) {
      transferArray = [tr];
    } else {
      return null; // Not a valid transfer function entry.
    }

    const transferMaps: (Uint8Array | null)[] = [];
    let numFns = 0;
    let numEffectfulFns = 0;
    for (const entry of transferArray) {
      const transferObj = this.context.xref.fetchIfRef(entry);
      numFns++;

      if (isName(transferObj, "Identity")) {
        transferMaps.push(null);
        continue;
      } else if (!isPDFFunction(transferObj)) {
        return null; // Not a valid transfer function object.
      }

      const transferFn = this._pdfFunctionFactory.create(transferObj);
      const transferMap = new Uint8Array(256),
        tmp = new Float32Array(1);
      for (let j = 0; j < 256; j++) {
        tmp[0] = j / 255;
        transferFn(tmp, 0, tmp, 0);
        transferMap[j] = (tmp[0] * 255) | 0;
      }
      transferMaps.push(transferMap);
      numEffectfulFns++;
    }

    if (!(numFns === 1 || numFns === 4)) {
      return null; // Only 1 or 4 functions are supported, by the specification.
    }
    if (numEffectfulFns === 0) {
      return null; // Only /Identity transfer functions found, which are no-ops.
    }
    return transferMaps;
  }

  handleText(chars: string, state: State) {
    const font = state.font;
    const glyphs = font!.charsToGlyphs(chars);

    if (font!.data) {
      const isAddToPathSet = !!(
        state.textRenderingMode! & TextRenderingMode.ADD_TO_PATH_FLAG
      );
      if (
        isAddToPathSet || state.fillColorSpace!.name === "Pattern" ||
        font!.disableFontFace || this.context.options.disableFontFace
      ) {
        PartialEvaluator.buildFontPaths(
          font!, glyphs, this.context.handler, this.context.options
        );
      }
    }
    return glyphs;
  }
}