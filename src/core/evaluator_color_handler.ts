import { TransformType } from "../display/display_utils";
import { CommonObjType, ObjType } from "../shared/message_handler";
import { AbortException, FormatError, OPS, warn } from "../shared/util";
import { BaseStream } from "./base_stream";
import { ColorSpace } from "./colorspace";
import { lookupMatrix } from "./core_utils";
import { EvaluatorContext, PatternType } from "./evaluator";
import { LocalColorSpaceCache, LocalTilingPatternCache } from "./image_utils";
import { OperatorList } from "./operator_list";
import { getTilingPatternIR, Pattern } from "./pattern";
import { Dict, DictKey, Name, Ref } from "./primitives";
import { WorkerTask } from "./worker";

export class EvaluatorColorHandler {

  protected readonly context: EvaluatorContext;

  constructor(context: EvaluatorContext) {
    this.context = context;
  }

  handleColorN(
    operatorList: OperatorList,
    fn: OPS, // 值应当是OPS.setFillColorN | OPS.setFillColorN,
    args: any[],
    cs: ColorSpace,
    patterns: Dict,
    resources: Dict,
    task: WorkerTask,
    localColorSpaceCache: LocalColorSpaceCache,
    localTilingPatternCache: LocalTilingPatternCache,
    localShadingPatternCache: Map<Dict, string | null>
  ) {
    // compile tiling patterns
    const patternName = args.pop();
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

      const pattern = this.context.xref.fetchIfRef(rawPattern);
      if (pattern) {
        const dict: Dict = pattern instanceof BaseStream ? pattern.dict : pattern;
        const typeNum = dict.get(DictKey.PatternType);

        if (typeNum === PatternType.TILING) {
          const color = cs.base ? cs.base.getRgb(args, 0) : null;
          return this.handleTilingType(
            fn, color, resources, pattern, dict, operatorList, task, localTilingPatternCache
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
    fn: OPS, color: Uint8ClampedArray | null, resources: Dict, pattern: BaseStream,
    patternDict: Dict, operatorList: OperatorList, task: WorkerTask, localTilingPatternCache: LocalTilingPatternCache
  ) {
    // Create an IR of the pattern code.
    const tilingOpList = new OperatorList();
    // Merge the available resources, to prevent issues when the patternDict
    // is missing some /Resources entries (fixes issue6541.pdf).
    const patternResources = Dict.merge(
      this.context.xref, [patternDict.get(DictKey.Resources), resources], false
    );

    return this.context.operatorFactory.createGeneralOperator().handle(pattern, task, patternResources, tilingOpList).then(() => {
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

  async parseColorSpace(
    cs: Name | Ref | (Ref | Name)[], resources: Dict | null, localColorSpaceCache: LocalColorSpaceCache
  ) {
    return ColorSpace.parseAsync(
      cs, this.context.xref, resources, this.context.pdfFunctionFactory, localColorSpaceCache
    ).catch(reason => {
      if (reason instanceof AbortException) {
        return null;
      }
      if (this.context.options.ignoreErrors) {
        warn(`parseColorSpace - ignoring ColorSpace: "${reason}".`);
        return null;
      }
      throw reason;
    });
  }
}