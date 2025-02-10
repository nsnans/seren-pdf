import { AnnotationEditorType } from "../../shared/util";
import { IL10n } from "../../viewer/common/component_types";
import { FreeTextEditor, FreeTextEditorParameter } from "./freetext";
import { HighlightEditor, HighlightEditorParameter } from "./highlight";
import { InkEditor, InkEditorParameter } from "./ink";
import { StampEditor, StampEditorParameter } from "./stamp";
import { AnnotationEditorUIManager } from "./tools";

interface AnnotationEditorDescriptor<P, T> {
  initialize: (l10n: IL10n, uiManager: AnnotationEditorUIManager) => void;
  create: (params: P) => T;
  type: AnnotationEditorType;
  name: string;
  canCreateNewEmptyEditor: boolean;
}

export class AnnotationEditorRegistry {

  protected static annotationEditorDescriptorMap = new Map<AnnotationEditorType, AnnotationEditorDescriptor<unknown, unknown>>();

  static {
    this.registerEditor({
      initialize: FreeTextEditor.initialize,
      name: FreeTextEditor._type,
      type: AnnotationEditorType.FREETEXT,
      canCreateNewEmptyEditor: FreeTextEditor.canCreateNewEmptyEditor(),
      create: (params: FreeTextEditorParameter) => new FreeTextEditor(params),
    });
    this.registerEditor({
      initialize: InkEditor.initialize,
      name: InkEditor._type,
      type: AnnotationEditorType.INK,
      canCreateNewEmptyEditor: InkEditor.canCreateNewEmptyEditor(),
      create: (param: InkEditorParameter) => new InkEditor(param),
    });
    this.registerEditor({
      initialize: StampEditor.initialize,
      name: StampEditor._type,
      type: AnnotationEditorType.STAMP,
      canCreateNewEmptyEditor: StampEditor.canCreateNewEmptyEditor(),
      create: (param: StampEditorParameter) => new StampEditor(param),
    });
    this.registerEditor({
      initialize: HighlightEditor.initialize,
      name: HighlightEditor._type,
      type: AnnotationEditorType.HIGHLIGHT,
      canCreateNewEmptyEditor: StampEditor.canCreateNewEmptyEditor(),
      create: (param: HighlightEditorParameter) => new HighlightEditor(param),
    });
  }

  static registerEditor<P, T>(desc: AnnotationEditorDescriptor<P, T>) {
    if (this.annotationEditorDescriptorMap.has(desc.type)) {
      throw new Error("重复注册批注类型" + desc.type);
    }
    this.annotationEditorDescriptorMap.set(desc.type, <AnnotationEditorDescriptor<unknown, unknown>>desc);
  }

  static getL10nInitializer() {
    const initializers: ((l10n: IL10n, uiManager: AnnotationEditorUIManager) => void)[] = [];
    for (const descriptor of this.annotationEditorDescriptorMap.values()) {
      initializers.push(descriptor.initialize);
    }
    return initializers;
  }

  static getEditorBasicInfo() {
    const infos: { type: AnnotationEditorType, name: string }[] = []
    for (const descriptor of this.annotationEditorDescriptorMap.values()) {
      infos.push({ type: descriptor.type, name: descriptor.name });
    }
    return infos;
  }

  static getDescriptor(type: AnnotationEditorType) {
    return this.annotationEditorDescriptorMap.get(type) ?? null;
  }
}