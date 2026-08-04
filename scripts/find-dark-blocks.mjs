// 在截图中寻找接近纯黑的大块矩形区域（用于排查“黑块”）
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG } = require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs');

const file = process.argv[2] || 'D:/good-thing/cs/.smoke/04-buy.png';
const png = PNG.sync.read(readFileSync(file));
const { data, width, height } = png;

// 行/列投影找暗区
const rowDark = new Array(height).fill(0);
const colDark = new Array(width).fill(0);
const DARK = 22; // RGB 总和阈值
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const sum = data[i] + data[i + 1] + data[i + 2];
    if (sum < DARK) {
      rowDark[y]++;
      colDark[x]++;
    }
  }
}

const findRuns = (arr, minLen) => {
  const runs = [];
  let start = -1;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 0 && start < 0) start = i;
    if (arr[i] === 0 && start >= 0) {
      if (i - start >= minLen) runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0 && arr.length - start >= minLen) runs.push([start, arr.length - 1]);
  return runs;
};

const rows = findRuns(rowDark, 20);
const cols = findRuns(colDark, 20);
console.log('文件:', file, `${width}x${height}`);
console.log('暗色行区间:', JSON.stringify(rows));
console.log('暗色列区间:', JSON.stringify(cols));

// 每个 (行区间 × 列区间) 组合里统计暗像素占比，找真正的“黑块”
for (const [y0, y1] of rows.slice(0, 8)) {
  for (const [x0, x1] of cols.slice(0, 8)) {
    let dark = 0, total = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * width + x) * 4;
        total++;
        if (data[i] + data[i + 1] + data[i + 2] < DARK) dark++;
      }
    }
    const ratio = dark / total;
    if (ratio > 0.5 && total > 5000) {
      console.log(`黑块候选: x[${x0}..${x1}] y[${y0}..${y1}] 尺寸 ${x1 - x0 + 1}x${y1 - y0 + 1} 暗占比 ${(ratio * 100).toFixed(1)}%`);
    }
  }
}
