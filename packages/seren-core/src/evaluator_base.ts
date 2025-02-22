import { TransformType, RectType } from "../display/display_utils";
import { AbortException, FormatError, OPS, warn } from "../shared/util";
import { MutableArray } from "../types";
import { BaseStream } from "./base_stream";
import { ColorSpace } from "./colorspace";
import { SMaskOptions } from "./core_types";
import { lookupMatrix, lookupNormalRect } from "./core_utils";
import { EvaluatorContext, State } from "./evaluator";
import { GroupOptions, LocalColorSpaceCache, OptionalContent } from "./image_utils";
import { OperatorList } from "./operator_list";
import { Name, Dict, DictKey, Ref, isName } from "./primitives";
import { WorkerTask } from "./worker";

export const SKIP = 1;

export const OVER = 2;

export const DEFAULT = "DEFAULT";

export interface ProcessOperation {
  fn: OPS | null;
  args: MutableArray<any> | null;
}

export class EvaluatorBaseHandler {

  protected readonly context: EvaluatorContext;

  constructor(context: EvaluatorContext) {
    this.context = context;
  }

  async parseMarkedContentProps(
    contentProperties: Name | Dict, resources: Dict | null
  ): Promise<OptionalContent | null> {
    let optionalContent: Dict;
    if (contentProperties instanceof Name) {
      const properties = resources!.getValue(DictKey.Properties);
      optionalContent = <Dict>properties.get(<DictKey>contentProperties.name);
    } else if (contentProperties instanceof Dict) {
      optionalContent = contentProperties;
    } else {
      throw new FormatError("Optional content properties malformed.");
    }

    const optionalContentType = (<Name>optionalContent.get(DictKey.Type))?.name;
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
            ? (<Name>optionalContent.get(DictKey.P)).name : null,
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

  async buildFormXObject(
    resources: Dict, xobj: BaseStream, smask: SMaskOptions | null, operatorList: OperatorList,
    task: WorkerTask, initialState: State, localColorSpaceCache: LocalColorSpaceCache
  ) {
    const dict = xobj.dict!;
    const matrix = <TransformType | null>lookupMatrix(dict.getArrayValue(DictKey.Matrix), null);
    const bbox = lookupNormalRect(dict.getArrayValue(DictKey.BBox), null);

    let optionalContent, groupOptions: GroupOptions | null = null;
    if (dict.has(DictKey.OC)) {
      optionalContent = await this.parseMarkedContentProps(
        dict.getValue(DictKey.OC), resources
      );
    }
    if (optionalContent !== undefined) {
      operatorList.addOp(OPS.beginMarkedContentProps, ["OC", optionalContent]);
    }
    const group = dict.getValue(DictKey.Group);
    if (group) {
      groupOptions = {
        matrix, bbox, smask, isolated: false, knockout: false,
      };

      const groupSubtype = group.get(DictKey.S);
      let colorSpace = null;
      if (isName(groupSubtype, "Transparency")) {
        groupOptions!.isolated = !!group.getValue(DictKey.I) || false;
        groupOptions!.knockout = !!group.getValue(DictKey.K) || false;
        if (group.has(DictKey.CS)) {
          const cs = group.getRaw(DictKey.CS);
          const cachedColorSpace = ColorSpace.getCached(
            cs, this.context.xref, localColorSpaceCache
          );
          if (cachedColorSpace) {
            colorSpace = cachedColorSpace;
          } else {
            colorSpace = await this.parseColorSpace(
              cs, resources, localColorSpaceCache,
            );
          }
        }
      }

      if (smask?.backdrop) {
        colorSpace ||= ColorSpace.singletons.rgb;
        smask.backdrop = colorSpace.getRgb(smask.backdrop, 0);
      }

      operatorList.addOp(OPS.beginGroup, [groupOptions]);
    }

    // If it's a group, a new canvas will be created that is the size of the
    // bounding box and translated to the correct position so we don't need to
    // apply the bounding box to it.
    const args: [TransformType | null, RectType | null] = group ? [matrix, null] : [matrix, bbox];
    operatorList.addOp(OPS.paintFormXObjectBegin, args);

    await this.context.operatorFactory.createGeneralHandler(
      xobj, task, dict.getValue(DictKey.Resources) || resources, operatorList, initialState
    ).handle();
    operatorList.addOp(OPS.paintFormXObjectEnd, []);

    if (group) {
      operatorList.addOp(OPS.endGroup, [groupOptions!]);
    }

    if (optionalContent !== undefined) {
      operatorList.addOp(OPS.endMarkedContent, []);
    }
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

export interface OperatorListHandler {

  handle(): Promise<void>;

}