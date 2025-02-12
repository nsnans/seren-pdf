
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

