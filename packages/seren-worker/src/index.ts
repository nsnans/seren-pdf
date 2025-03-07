// 这样引入后没办法直接跳转worker了，有一点小瑕疵。
import Worker from './worker.ts?worker'

export default Worker;