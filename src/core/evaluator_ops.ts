import { OPS } from "../pdf";
import { BaseStream } from "./base_stream";
import { EvalState, EvaluatorPreprocessor, State, StateManager, TimeSlotManager } from "./evaluator";
import { OperatorList } from "./operator_list";
import { Dict, Name } from "./primitives";
import { WorkerTask } from "./worker";
import { XRef } from "./xref";

const MethodMap = new Map<OPS, string>();

function handle(ops: OPS) {
  return function (_target: any, propertyKey: string) {
    if (MethodMap.has(ops)) {
      throw new Error("不能够重复为同一个操作符定义多个操作对象")
    }
    MethodMap.set(ops, propertyKey);
  }
}

class Operator {

  protected next: (promise: Promise<unknown>) => void;

  constructor(next: (promise: Promise<unknown>) => void) {
    this.next = next;
  }

  buildOperatorMap() {
    const self = <any>this;
    const map = new Map<OPS, (context: ProcessContext) => void>();
    for (const [k, v] of MethodMap) {
      const fn = self[v];
      if (fn == null || typeof fn !== 'function') {
        throw new Error("操作符和操作方法不匹配");
      }
      map.set(k, fn.bind(this));
    }
    return map;
  }


  @handle(OPS.beginAnnotation)
  beginAnnotation() {
  }

  @handle(OPS.paintXObject)
  paintXObject(context: ProcessContext) {
   
  }

  @handle(OPS.setFont)
  setFont() {

  }

  @handle(OPS.beginText)
  beginText() {

  }

  @handle(OPS.endText)
  endText() {

  }

  @handle(OPS.endInlineImage)
  endInlineImage() {

  }

  @handle(OPS.showText)
  showText() {

  }

  @handle(OPS.showSpacedText)
  showSpacedText() {

  }

  @handle(OPS.nextLineShowText)
  nextLineShowText() {

  }

  @handle(OPS.nextLineSetSpacingShowText)
  nextLineSetSpacingShowText() {

  }

  @handle(OPS.setTextRenderingMode)
  setTextRenderingMode() {

  }

  @handle(OPS.setFillColorSpace)
  setFillColorSpace() {

  }

  @handle(OPS.setStrokeColorSpace)
  setStrokeColorSpace() {

  }

  @handle(OPS.setFillColor)
  setFillColor() {

  }

  @handle(OPS.setFillRGBColor)
  setFillRGBColor() {

  }

  @handle(OPS.setStrokeColor)
  setStrokeColor() {

  }
  @handle(OPS.setStrokeRGBColor)
  setStrokeRGBColor() {

  }

  @handle(OPS.setFillGray)
  setFillGray() {

  }

  @handle(OPS.setStrokeGray)
  setStrokeGray() {

  }

  @handle(OPS.setFillCMYKColor)
  setFillCMYKColor() {

  }

  @handle(OPS.setStrokeCMYKColor)
  setStrokeCMYKColor() {

  }

  @handle(OPS.setFillColorN)
  setFillColorN() {

  }

  @handle(OPS.setFillTransparent)
  setFillTransparent() {

  }

  @handle(OPS.setStrokeColorN)
  setStrokeColorN() {

  }

  @handle(OPS.setStrokeTransparent)
  setStrokeTransparent() {

  }

  @handle(OPS.shadingFill)
  shadingFill() {

  }

  @handle(OPS.setGState)
  setGState() {

  }

  @handle(OPS.moveTo)
  moveTo() {

  }

  @handle(OPS.lineTo)
  lineTo() {

  }

  @handle(OPS.curveTo)
  curveTo() {

  }

  @handle(OPS.curveTo2)
  curveTo2() {

  }

  @handle(OPS.curveTo3)
  curveTo3() {

  }

  @handle(OPS.closePath)
  closePath() {

  }

  @handle(OPS.rectangle)
  rectangle() {

  }

  @handle(OPS.markPoint)
  markPoint() {

  }

  @handle(OPS.markPointProps)
  markPointProps() {

  }

  @handle(OPS.beginCompat)
  beginCompat() {

  }

  @handle(OPS.endCompat)
  endCompat() {

  }

  @handle(OPS.beginMarkedContentProps)
  beginMarkedContentProps() {

  }

  @handle(OPS.beginMarkedContent)
  beginMarkedContent() {

  }

  @handle(OPS.endMarkedContent)
  endMarkedContent() {

  }
}

class Operators {

  protected readonly operators: Map<OPS, (context: ProcessContext) => void>;

  constructor(operator: Operator) {
    this.operators = operator.buildOperatorMap();
  }

  execute(ops: OPS, context: ProcessContext): boolean {
    const fn = this.operators.get(ops);
    if (fn) {
      fn(context);
      return true;
    }
    return false;
  }
}

interface ProcessOperation {
  fn: OPS | null;
  args: any[] | null;
}

interface ProcessContext {
  operation: ProcessOperation;
}

export class GetOperatorListHandler {

  protected operators: Operators | null = null;

  protected operatorList: OperatorList;

  protected task: WorkerTask;

  protected timeSlotManager = new TimeSlotManager();

  protected stateManager: StateManager;

  protected preprocessor: EvaluatorPreprocessor;

  constructor(
    stream: BaseStream,
    task: WorkerTask,
    xref: XRef,
    resources: Dict,
    operatorList: OperatorList,
    initialState: State = new EvalState(),
    fallbackFontDict: Dict | null = null,
  ) {
    if (!operatorList) {
      throw new Error('getOperatorList: missing "operatorList" parameter');
    }
    this.stateManager = new StateManager(initialState);
    this.task = task;
    this.operatorList = operatorList;
    this.preprocessor = new EvaluatorPreprocessor(stream, xref, this.stateManager)
  }

  initOperators(resolve: (value: void | PromiseLike<void>) => void, reject: (reason?: any) => void) {
    const operatorList = this.operatorList;
    const process = this.process.bind(this);
    const next = (promise: Promise<unknown> | null) => {
      Promise.all([promise, operatorList.ready]).then(() => {
        try {
          process(resolve, reject);
        } catch (ex) {
          reject(ex)
        }
      }, reject);
    }
    this.operators = new Operators(new Operator(next));
  }

  process(
    resolve: (value: void | PromiseLike<void>) => void,
    reject: (reason?: any) => void
  ) {
    if (this.operators === null) {
      this.initOperators(resolve, reject);
    }
    const timeSlotManager = this.timeSlotManager;
    const preprocessor = this.preprocessor;
    const operators = this.operators!;
    this.task.ensureNotTerminated();
    this.timeSlotManager.reset();

    const operation = {
      fn: <OPS | null>null,
      args: <any[] | null>null,
    }
    // 尽量减少变量的定义，不然会多耗费很多时间
    let stop: boolean;
    const context: ProcessContext = {
      operation
    }
    while (!(stop = timeSlotManager.check())) {
      operation.args = null;
      if (!preprocessor.read(operation)) {
        break;
      }
      let fn = operation.fn!;
      operators.execute(fn, context);
    }
  }
}