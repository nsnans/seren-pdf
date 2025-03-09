import { defineConfig } from 'vite';

/**
 * 因为PDF的处理需要判断PDF是否支持分段加载，但是默认情况下vite不带Accept-Ranges
 * 因此需要写一个插件，来给文件加上请求头信息。
 */
function acceptRangesForPDF() {
  return {
    name: 'acceptRangesForPDF',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        try {
          const pathname = req.url.split(/[?#]/)[0];
          if (pathname.toLowerCase().endsWith('.pdf')) {
            res.setHeader('Accept-Ranges', 'bytes');
          }
        } catch (e) {
          console.log(e)
        }
        next();
      })
    }
  }
}

export default defineConfig({
  plugins: [acceptRangesForPDF()],
  build: {
    outDir: 'dist', // 指定输出目录
    assetsDir: 'assets', // 指定静态资源目录
    sourcemap: true, // 是否生成 sourcemap
  },
});