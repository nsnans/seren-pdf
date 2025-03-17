import { VerbosityLevel, WebSerenViewer, WebViewerController } from "seren-web";

function bindEvents(controller: WebViewerController) {
  document.getElementById("pdf-page-up")?.addEventListener("click", () => {
    controller.pageUp();
  })
  document.getElementById("pdf-page-down")?.addEventListener("click", () => {
    controller.pageDown();
  })
}

const viewer = WebSerenViewer.init('app', {
  viewerScale: 0.7
});
let controller;
viewer.open({
  url: 'compressed.tracemonkey-pldi-09.pdf',
  verbosity: VerbosityLevel.WARNINGS
}).then(() => {
  controller = viewer.getViewController();
  bindEvents(controller);
})

