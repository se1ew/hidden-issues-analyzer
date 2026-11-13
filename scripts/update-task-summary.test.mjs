import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repositoryTasks = await fs.readFile(new URL('../TASKS.md', import.meta.url), 'utf8');
const script = await fs.readFile(new URL('./update-task-summary.mjs', import.meta.url), 'utf8');

async function run(input, callback) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'reviewlens-tasks-'));
  try {
    await fs.mkdir(path.join(directory, 'scripts'));
    await fs.writeFile(path.join(directory, 'scripts/update-task-summary.mjs'), script);
    const tasks = path.join(directory, 'TASKS.md');
    await fs.writeFile(tasks, input);
    const result = spawnSync(process.execPath, [path.join(directory, 'scripts/update-task-summary.mjs')], { encoding: 'utf8', windowsHide: true });
    await callback(result, await fs.readFile(tasks, 'utf8'), directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

for (const newline of ['\n', '\r\n']) {
  test(`preserves tasks, notes and line endings (${JSON.stringify(newline)})`, async () => {
    const expected = repositoryTasks.replace(/\r?\n/g, newline);
    const input = expected
      .replace(/Выполнено \d+ из \d+ задач;/, 'Выполнено 0 из 0 задач;')
      .replace(/открыто \d+\./, 'открыто 0.');
    await run(input, async (result, output, directory) => {
      assert.equal(result.status, 0, result.stderr);
      assert.equal(output, expected);
      const repeated = spawnSync(process.execPath, [path.join(directory, 'scripts/update-task-summary.mjs')], { encoding: 'utf8', windowsHide: true });
      assert.equal(repeated.status, 0, repeated.stderr);
      assert.equal(await fs.readFile(path.join(directory, 'TASKS.md'), 'utf8'), output);
    });
  });
}

test('derives totals from phase checklists and excludes active tasks and history', async () => {
  const rows = Array.from({ length: 20 }, (_, index) => `| ${index} | Phase ${index} | 0/0 | **Всё выполнено** |`).join('\n');
  const phases = Array.from({ length: 20 }, (_, index) =>
    `## Фаза ${index}: Phase ${index}\n\n${index === 0 ? '- [x] First\n- [ ] Second\n- [x] Third\n' : 'No tasks yet.\n'}`).join('\n');
  const input = '# Tasks\n\n## Active\n\n- [x] Active task\n\n'
    + '## Все фазы — одним взглядом\n\nВыполнено 0 из 0 задач;\nоткрыто 0.\n\n'
    + '| Фаза | Название | Выполнено | Статус |\n| --- | --- | ---: | --- |\n' + rows
    + '\n\nKeep these summary notes.\n\n' + phases + '\n## History\n\n- [x] Historical task\n';
  await run(input, (result, output) => {
    assert.equal(result.status, 0, result.stderr);
    assert.equal(output, input.replace('Выполнено 0 из 0 задач;', 'Выполнено 2 из 3 задач;')
      .replace('открыто 0.', 'открыто 1.')
      .replace('| 0 | Phase 0 | 0/0 | **Всё выполнено** |', '| 0 | Phase 0 | 2/3 | Осталось: 1 |'));
  });
});

for (const input of [
  repositoryTasks.replace('## Фаза 0:', '## Отсутствующая фаза:'),
  repositoryTasks.replace('## Фаза 19:', '## Фаза 18:'),
  repositoryTasks.replace('## Все фазы — одним взглядом', '## Нет сводки'),
  repositoryTasks.replace('| Фаза | Название | Выполнено | Статус |', '| Другая таблица |'),
]) {
  test('leaves an invalid document untouched', async () => {
    await run(input, (result, output) => {
      assert.notEqual(result.status, 0);
      assert.equal(output, input);
    });
  });
}
