// 分析截图：平均色、亮度方差、非黑像素占比，用于无头验证画面是否真的渲染
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs');

const dir = 'D:/good-thing/cs/.smoke';
for (const f of readdirSync(dir).filter((f) => f.endsWith('.png')).sort()) {
  const png = PNG.sync.read(readFileSync(`${dir}/${f}`));
  const { data, width, height } = png;
  let r = 0, g = 0, b = 0, nonBlack = 0, bright = 0, total = 0;
  const buckets = new Set();
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
    total++;
    if (data[i] + data[i + 1] + data[i + 2] > 18) nonBlack++;
    if (data[i] + data[i + 1] + data[i + 2] > 450) bright++;
    buckets.add((data[i] >> 5) + ((data[i + 1] >> 5) << 3) + ((data[i + 2] >> 5) << 6));
  }
  const avg = (v) => Math.round(v / total);
  console.log(
    `${f}: ${width}x${height} avg=(${avg(r)},${avg(g)},${avg(b)}) 非黑${(nonBlack / total * 100).toFixed(1)}% 亮${(bright / total * 100).toFixed(1)}% 色桶${buckets.size}`,
  );
}
