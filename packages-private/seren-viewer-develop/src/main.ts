import { WebSerenViewer } from "seren-web";
import { VerbosityLevel } from '../../../packages/seren-common/src/utils/util';

const viewer = WebSerenViewer.init('app');
viewer.open({
  url: 'compressed.tracemonkey-pldi-09.pdf',
  verbosity: VerbosityLevel.INFOS
})