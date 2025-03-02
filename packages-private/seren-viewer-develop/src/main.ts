import { WebSerenViewer } from "seren-web";

const viewer = WebSerenViewer.init('app');
viewer.open({
  url: 'compressed.tracemonkey-pldi-09.pdf'
})