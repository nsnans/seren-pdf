import { VerbosityLevel, WebSerenViewer, WebViewerController } from "seren-web";

const DEFAULT = "/pdfs/_compressed.tracemonkey-pldi-09.pdf";

const viewer = WebSerenViewer.init('app', {
  viewerScale: 0.7
});

viewer.open({
  url: DEFAULT,
  verbosity: VerbosityLevel.WARNINGS
}).then(() => {
  const controller = viewer.getViewController();
  bindEvents(controller);
})

setTimeout(()=>{
  viewer.close();
}, 5000)

function bindEvents(controller: WebViewerController) {
  document.getElementById("pdf-page-up")?.addEventListener("click", () => {
    controller.pageUp();
  })
  document.getElementById("pdf-page-down")?.addEventListener("click", () => {
    controller.pageDown();
  })
}
