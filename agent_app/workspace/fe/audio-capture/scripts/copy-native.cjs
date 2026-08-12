/**
 * copy-native.cjs —— 把编译好的 WASAPI addon 拷贝到 dist-electron
 *
 * tsc 只编译 .ts，不复制 .node；dev/打包时 electron 从
 * dist-electron/audio/native/build/Release/wasapi_loopback.node 加载，
 * 因此编译 addon 后必须同步到产物目录。
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'electron', 'audio', 'native', 'build', 'Release', 'wasapi_loopback.node');
const DEST_DIR = path.join(__dirname, '..', 'dist-electron', 'audio', 'native', 'build', 'Release');

if (fs.existsSync(SRC)) {
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.copyFileSync(SRC, path.join(DEST_DIR, 'wasapi_loopback.node'));
  console.log('[copy-native] addon 已拷贝到 dist-electron/audio/native/build/Release/');
} else {
  console.warn('[copy-native] 未找到 addon（未编译）。先执行: cd electron/audio/native && npx node-gyp rebuild --target=43.4.0 --dist-url=https://electronjs.org/headers');
}
