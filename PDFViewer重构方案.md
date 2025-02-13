
第三方调用者 应该最近简单的使用。

interface WebPDFViewerInitializer{

}

const serenWebViewer = Seren.initWebViewer(options, initializer);

// view 用来获取PDFViewer的一些信息的，比如页数，比如PDF基本信息
const view : WebPDFViewerView = serenWebViewer.getView();
// api用来回调代码，比如跳转页面，跳转页面后滚动多少px
const api : WebPDFViewerApi = serenWebViewer.getApi();
// 用来管理回调，可以添加或者删除回调代码
const callbackManager = serenWebViewer.callbackManager();

const serenWebViewer = Seren.initWebViewer(options, initializer);
options应该是一个Partial<Option>,initializer应该是一个interface。

Seren.initWebViewer需要先完善options，然后生成一个context。然后所有的PDFViewer，
要么持有这个context，要么将这个context中的属性单独拿出来，相当于拷贝一份。
初始化所有对象过程的时候，需要将initializer中的代码也执行一遍。

callbackManger可以在一些事件发生变化的时候，同步回调代码。可以根据一定的条件，删除某些回调，或者添加一些新的回调。

然后第一件事是options，开关的处理，应当是一个partial对象

page_view ==> 一个关键的类，负责管理单个页面的各种操作。

渲染 => 生成四大Layer，TextLayer是一个隐藏的Layer，可以用来做文字的高亮、搜索、选中。

page_view 应该提供接口供page_view_manager调用。并且有一些响应回调事件。

page_view管理的这些Layer，同时也要被AnnotationEditorUIManager管理，也就是说Layer要接受多个上级调用，这样该如何写代码呢？

on相关的代码先移除吧，在代码内部组件里通过消息队列的解耦。具备了灵活性，但是同样的代码也变的不直观了，也不是很方便统一的管理。我觉得这种监听还是都先移除吧。
