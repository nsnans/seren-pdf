import {
  TransformType,
  MutableArray,
  AbortException,
  FormatError,
  OPS, warn, DictKey, Name, Ref
} from "seren-common";
import { CommonObjType, ObjType } from "../shared/message_handler";
import { BaseStream } from "../../stream/base_stream";
import { ColorSpace } from "../../color/colorspace";
import { lookupMatrix } from "../../utils/core_utils";
import { EvaluatorContext, PatternType } from "./evaluator";
import { EvaluatorBaseHandler } from "./evaluator_base";
import { LocalColorSpaceCache, LocalTilingPatternCache } from "../../image/image_utils";
import { OperatorList } from "../operator_list";
import { getTilingPatternIR, Pattern } from "../pattern";
import { Dict } from "packages/seren-common/src/document/dict";
import { WorkerTask } from "../../worker/worker";
import { DictImpl } from "../../document/dict_impl";

export class EvaluatorColorHandler extends EvaluatorBaseHandler {

  constructor(context: EvaluatorContext) {
    super(context);
  }

  handleColorN(
    operatorList: OperatorList,
    fn: OPS, // 值应当是OPS.setFillColorN | OPS.setFillColorN,
    args: MutableArray<any>,
    cs: ColorSpace,
    patterns: Dict,
    resources: Dict,
    task: WorkerTask,
    localColorSpaceCache: LocalColorSpaceCache,
    localTilingPatternCache: LocalTilingPatternCache,
    localShadingPatternCache: Map<Dict, string | null>
  ) {
    // compile tiling patterns
    const patternName = (<any[]>args).pop();
    // SCN/scn applies patterns along with normal colors
    if (patternName instanceof Name) {
      const rawPattern = <Ref | BaseStream | Dict>patterns.getRaw(<DictKey>patternName.name);

      const localTilingPattern = rawPattern instanceof Ref && localTilingPatternCache.getByRef(rawPattern);
      if (localTilingPattern) {
        try {
          const color = cs.base ? cs.base.getRgb(args, 0) : null;
          const tilingPatternIR = getTilingPatternIR(
            localTilingPattern.operatorListIR, localTilingPattern.dict, color
          );
          operatorList.addOp(fn, <any>tilingPatternIR);
          return undefined;
        } catch {
          // Handle any errors during normal TilingPattern parsing.
        }
      }

      const pattern = <BaseStream | Dict | null>this.context.xref.fetchIfRef(rawPattern);
      if (pattern) {
        const dict = pattern instanceof BaseStream ? pattern.dict! : pattern;
        const typeNum = dict.getValue(DictKey.PatternType);

        if (typeNum === PatternType.TILING) {
          const color = cs.base ? cs.base.getRgb(args, 0) : null;
          return this.handleTilingType(
            fn, color, resources, <BaseStream>pattern, dict, operatorList, task, localTilingPatternCache
          );
        } else if (typeNum === PatternType.SHADING) {
          const shading = dict.getValue(DictKey.Shading);
          const objId = this.parseShading(
            shading, resources, localColorSpaceCache, localShadingPatternCache,
          );
          if (objId) {
            const matrix = <TransformType | null>lookupMatrix(dict.getArrayValue(DictKey.Matrix), null);
            operatorList.addOp(fn, ["Shading", objId, matrix]);
          }
          return undefined;
        }
        throw new FormatError(`Unknown PatternType: ${typeNum}`);
      }
    }
    throw new FormatError(`Unknown PatternName: ${patternName}`);
  }

  parseShading(
    shading: Dict, resources: Dict, localColorSpaceCache: LocalColorSpaceCache, localShadingPatternCache: Map<Dict, string | null>,
  ) {
    // Shadings and patterns may be referenced by the same name but the resource
    // dictionary could be different so we can't use the name for the cache key.
    let id = localShadingPatternCache.get(shading);
    if (id) {
      return id;
    }
    let patternIR;

    try {
      const shadingFill = Pattern.parseShading(
        shading, this.context.xref, resources, this.context.pdfFunctionFactory, localColorSpaceCache
      );
      patternIR = shadingFill.getIR();
    } catch (reason) {
      if (reason instanceof AbortException) {
        return null;
      }
      if (this.context.options.ignoreErrors) {
        warn(`parseShading - ignoring shading: "${reason}".`);
        localShadingPatternCache.set(shading, null);
        return null;
      }
      throw reason;
    }

    id = `pattern_${this.context.idFactory.createObjId()}`;
    if (this.context.parsingType3Font) {
      id = `${this.context.idFactory.getDocId()}_type3_${id}`;
    }
    localShadingPatternCache.set(shading, id);

    if (this.context.parsingType3Font) {
      this.context.handler.commonobj(id, CommonObjType.Pattern, patternIR);
    } else {
      this.context.handler.obj(id, this.context.pageIndex, ObjType.Pattern, patternIR);
    }
    return id;
  }

  async handleTilingType(
    fn: OPS, color: Uint8ClampedArray<ArrayBuffer> | null, resources: Dict, pattern: BaseStream,
    patternDict: Dict, operatorList: OperatorList, task: WorkerTask, localTilingPatternCache: LocalTilingPatternCache
  ) {
    // Create an IR of the pattern code.
    const tilingOpList = new OperatorList();
    // Merge the available resources, to prevent issues when the patternDict
    // is missing some /Resources entries (fixes issue6541.pdf).
    const patternResources = DictImpl.merge(
      this.context.xref, [patternDict.getValue(DictKey.Resources), resources], false
    );

    return this.context.operatorFactory.createGeneralHandler(
      pattern, task, patternResources, tilingOpList
    ).handle().then(() => {
      const operatorListIR = tilingOpList.getIR();
      const tilingPatternIR = getTilingPatternIR(
        operatorListIR, patternDict, color
      );

      // Add the dependencies to the parent operator list so they are
      // resolved before the sub operator list is executed synchronously.
      operatorList.addDependencies(tilingOpList.dependencies);
      operatorList.addOp(fn, tilingPatternIR);

      if (patternDict.objId) {
        localTilingPatternCache.set(null, patternDict.objId, {
          operatorListIR, dict: patternDict,
        });
      }
    }).catch((reason: unknown) => {
      if (reason instanceof AbortException) {
        return;
      }
      if (this.context.options.ignoreErrors) {
        warn(`handleTilingType - ignoring pattern: "${reason}".`);
        return;
      }
      throw reason;
    });
  }

}