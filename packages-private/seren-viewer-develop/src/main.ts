import { VerbosityLevel, WebSerenViewer, WebViewerController } from "seren-web";

function bindEvents(controller: WebViewerController) {
  document.getElementById("pdf-page-up")?.addEventListener("click", () => {
    controller.pageUp();
  })
  document.getElementById("pdf-page-down")?.addEventListener("click", () => {
    controller.pageDown();
  })
}

const viewer = WebSerenViewer.init('app');
let controller;
viewer.open({
  url: 'compressed.tracemonkey-pldi-09.pdf',
  verbosity: VerbosityLevel.WARNINGS
}, {
  afterPageDivInit: (_pageNum, _div) => {
  }
}).then(() => {
  controller = viewer.getViewController();
  bindEvents(controller);
})

