import { execFileSync } from 'node:child_process'

const tracked = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean)
const forbidden = [
  /^docs\/plans\//,
  /(^|\/)live2dcubismcore(\.min)?\.js(\.map)?$/,
  /\.(moc3|psd|psb|safetensors|ckpt|onnx)$/i,
  /(^|\/)weights\//,
  /^apps\/desktop\/src\/renderer\/public\/(golden|live2d)\//
]
const bad = tracked.filter((file) => forbidden.some((rule) => rule.test(file)))
if (bad.length > 0) {
  console.error(`prohibited files are tracked:\n${bad.join('\n')}`)
  process.exit(1)
}
console.log(`no-prohibited-assets: ${tracked.length} tracked file(s) checked`)
