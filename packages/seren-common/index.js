import exports from './src/index'

if (process.env.NODE_ENV === 'production') {
  module.exports = require('./dist/compiler-core.cjs.prod.js')
} else {
  module.exports = exports;
}
