import fs from 'node:fs/promises';
const file = new URL('../TASKS.md', import.meta.url);
const text = await fs.readFile(file, 'utf8');
const body = text.slice(text.indexOf('## Фаза 0:'));
if (!body.startsWith('## Фаза 0:')) throw new Error('Cannot find phase checklist');
const phases = [...body.matchAll(/^## Фаза (\d+): (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
if (phases.length !== 20) throw new Error('Expected exactly 20 phases');
let completed = 0; let open = 0;
const rows = phases.map(match => {
  const done = (match[3].match(/^- \[x\]/gm) ?? []).length;
  const left = (match[3].match(/^- \[ \]/gm) ?? []).length;
  completed += done; open += left;
  return `| ${match[1]} | ${match[2].trim()} | ${done}/${done + left} | ${left ? `Осталось: ${left}` : '**Всё выполнено**'} |`;
});
const intro = `# Задачи проекта

## Все фазы — одним взглядом

Сверено с кодом и проверками 20 октября 2026. Выполнено ${completed} из ${completed + open} задач;
открыто ${open}. Подробные чек-листы сохранены ниже.

| Фаза | Название | Выполнено | Статус |
| --- | --- | ---: | --- |
${rows.join('\n')}

В предыдущих фазах остаются: **2** — явное назначение старых данных и удаление
legacy-полей; **5** — проверка живого источника Wildberries; **12** — физический
проектор; **17** — оценка качества настоящей модели. Причины и точные границы
проверок: [аудит открытых задач](docs/backlog-audit.md).

Фазы **18–19** требуют целевого компьютера, развёртывания и итоговой приёмки.
Они не закрыты результатами проверки управляемых ответов модели на основном ПК.
Отчёты от 11–18 октября в конце файла — история работ; актуальна эта сводка
и отметки в чек-листах. Обновить счётчики: \`npm run tasks:summary\`.

`;
await fs.writeFile(file, intro + body);
console.log(rows.join('\n'));
