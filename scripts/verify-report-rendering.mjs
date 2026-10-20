import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, '.cache/operations-check'); await fs.mkdir(output, { recursive: true });
const original = JSON.parse(await fs.readFile(path.join(root, '.cache/analytics-report-check/snapshot.json'), 'utf8'));
const stress = structuredClone(original);
stress.product.name = 'Проверка длинных цитат и таблиц';
stress.analytics.aspects = Array.from({ length: 26 }, (_, index) => ({ category: 'quality', name: `Аспект ${index + 1} с длинным названием`, reviews: 3, positive: 1, negative: 2, neutral: 0 }));
stress.groups = [structuredClone(stress.groups[0])];
stress.groups[0].title = 'Длинные цитаты с переносами и проверяемые последствия';
stress.groups[0].evidence = Array.from({ length: 3 }, (_, index) => ({ ...stress.groups[0].evidence[0], reviewId: `long-${index}`, quote: ('Длинная цитата о крышке, которую трудно открыть. '.repeat(18) + '\nВторая строка со словами автора. ').repeat(2), consequences: 'Невозможно пользоваться' }));
const empty = structuredClone(original); empty.groups = []; empty.analytics.aspects = []; empty.publicationId = null;
const maximum = structuredClone(original); maximum.groups = [structuredClone(maximum.groups[0])];
maximum.groups[0].evidence = Array.from({ length: 2000 }, (_, index) => ({ ...maximum.groups[0].evidence[0], reviewId: `limit-${index}` }));
const measurements = [];
for (const [name, snapshot] of [['normal', original], ['long', stress], ['empty', empty], ['limit-2000', maximum]]) {
  for (const format of ['pdf', 'docx']) {
    const input = path.join(output, `${name}-${format}.json`), file = path.join(output, `${name}.${format}`);
    await fs.writeFile(input, JSON.stringify({ format, title: `Проверка отчёта ${name}`, snapshot }));
    const start = performance.now(); let peakRssBytes = 0;
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['--max-old-space-size=384', path.join(root, 'apps/api/dist/report-render-child.js'), input, file], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      const deadline = setTimeout(() => { child.kill(); reject(new Error('render timeout')); }, 120000);
      child.stderr.resume(); child.on('message', message => { peakRssBytes = message.peakRssBytes; });
      child.on('error', reject); child.on('close', code => { clearTimeout(deadline); code === 0 ? resolve() : reject(new Error(`render failed ${name}/${format}`)); });
    });
    const stat = await fs.stat(file); assert(stat.size > 1000); assert(peakRssBytes > 0);
    measurements.push({ name, format, elapsedMs: Math.round(performance.now() - start), peakRssBytes, outputBytes: stat.size });
    await fs.unlink(input);
  }
}
await fs.writeFile(path.join(output, 'render-benchmark.json'), JSON.stringify(measurements, null, 2));
console.log(JSON.stringify(measurements, null, 2));
