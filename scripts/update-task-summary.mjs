import fs from 'node:fs/promises';

const file = new URL('../TASKS.md', import.meta.url);
const text = await fs.readFile(file, 'utf8');
const checklistStart = text.indexOf('## Фаза 0:');
const summaryStart = text.indexOf('## Все фазы — одним взглядом');
if (checklistStart < 0) throw new Error('Cannot find phase checklist');
if (summaryStart < 0 || summaryStart >= checklistStart) throw new Error('Cannot find phase summary');

const body = text.slice(checklistStart);
const phases = [...body.matchAll(/^## Фаза (\d+): (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
if (phases.length !== 20 || phases.some((match, index) => Number(match[1]) !== index)) {
  throw new Error('Expected exactly 20 ordered phases');
}
let completed = 0; let open = 0;
const rows = phases.map(match => {
  const done = (match[3].match(/^- \[x\]/gm) ?? []).length;
  const left = (match[3].match(/^- \[ \]/gm) ?? []).length;
  completed += done; open += left;
  return `| ${match[1]} | ${match[2].trim()} | ${done}/${done + left} | ${left ? `Осталось: ${left}` : '**Всё выполнено**'} |`;
});

const summary = text.slice(summaryStart, checklistStart);
const counts = /Выполнено \d+ из \d+ задач;\r?\nоткрыто \d+\./;
const table = /^(\| Фаза \| Название \| Выполнено \| Статус \|\r?\n\| --- \| --- \| ---: \| --- \|\r?\n)(?:\| \d+ \|[^\r\n]*(?:\r?\n|$))+/m;
if (!counts.test(summary) || !table.test(summary)) throw new Error('Cannot find summary counts and table');
const newline = text.includes('\r\n') ? '\r\n' : '\n';
const updated = summary
  .replace(counts, `Выполнено ${completed} из ${completed + open} задач;${newline}открыто ${open}.`)
  .replace(table, (_, header) => header + rows.join(newline) + newline);
await fs.writeFile(file, text.slice(0, summaryStart) + updated + body);
console.log(rows.join('\n'));
