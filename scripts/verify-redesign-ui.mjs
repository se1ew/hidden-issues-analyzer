// Browser-only API fixtures; production code always uses the real API.
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.WEB_BASE_URL || 'http://127.0.0.1:5176';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = fileURLToPath(new URL('../.cache/redesign-check', import.meta.url));
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: 'Europe/Moscow',
});
const page = await context.newPage();
const errors = [];
page.setDefaultTimeout(12000);
page.on('pageerror', (error) => errors.push(error.message));
const productName = 'Беспроводные наушники ReviewLens Pro';
const run = {
  id: 'run',
  runId: 'run',
  productId: 'p',
  status: 'partial',
  stage: 'persistence',
  total: 4,
  succeeded: 3,
  failed: 1,
  processed: 4,
  remaining: 0,
  stateVersion: 5,
  createdAt: '2026-10-18T10:00:00Z',
  startedAt: '2026-10-18T10:00:01Z',
  finishedAt: '2026-10-18T10:01:00Z',
  cancelRequestedAt: null,
  finishReason: 'review_errors',
  provider: 'local',
  model: 'fixture-model',
  scope: {},
};
const product = {
  id: 'p',
  name: productName,
  source: 'csv',
  sourceUrl: null,
  externalId: '123',
  reviewsCount: 4,
  analyzedCount: 3,
  avgRating: 4.5,
  createdAt: run.createdAt,
  latestRun: run,
};
const group = {
  id: 's',
  title: 'Качество: крышка заедает',
  defect: 'крышка заедает',
  category: 'quality',
  scope: 'product',
  needsReview: false,
  problem: { id: 'problem', status: 'new', stateVersion: 0, events: [] },
  candidateProblems: [],
  mentionIds: ['mention'],
  representatives: [
    {
      id: 'mention',
      text: 'Отлично, но крышка заедает',
      quote: 'крышка заедает',
      quoteStart: 12,
      quoteEnd: 26,
      rating: 5,
      sentiment: 'positive',
      consequences: null,
    },
  ],
  metrics: {
    support: 2,
    mentionCount: 2,
    prevalence: 2 / 3,
    signal: false,
    hidden: true,
    positiveContextCount: 2,
    highRatingCount: 2,
    knownRatingCount: 2,
    highRatingShare: 1,
    positiveSentimentCount: 2,
    sentimentDenominator: 2,
    positiveSentimentShare: 1,
    coverage: { total: 4, succeeded: 3, failed: 1, remaining: 0, ratio: 0.75 },
    priority: {
      version: 'support-masking-consequence-v1',
      score: 200020,
      explanation: 'Сначала поддержка, затем положительный контекст',
      evidenceLabel: 'Повторяющаяся жалоба',
      limitation: 'Критичность и вероятность не измерены',
    },
  },
};
let failStats = false;
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url()),
    p = url.pathname;
  if (p.endsWith('/auth/refresh') || p.endsWith('/auth/login'))
    return route.fulfill({
      json: { user: { id: 'u', email: 'test@example.com', name: 'Тест' }, accessToken: 'fixture' },
    });
  if (p.endsWith('/analysis/stats'))
    return route.fulfill(
      failStats
        ? { status: 503, json: { code: 'unavailable', message: 'База временно недоступна' } }
        : {
            json: {
              hasRun: true,
              loadedTotal: 8,
              scopeTotal: 4,
              succeededCount: 3,
              failedCount: 1,
              remainingCount: 0,
              coverageRatio: 0.75,
              unprocessedCount: 4,
              runStatus: 'partial',
              publicationId: 'pub',
              problemCount: 1,
              hiddenProblemCount: 1,
              newProblemCount: 1,
              signalCount: 0,
              scope: { productId: 'p', runId: 'run', period: null },
              total: 4,
              analyzed: 3,
              pending: 0,
              avgRating: 4.5,
              analytics: {
                total: 100,
                succeeded: 90,
                failed: 10,
                ratingCount: 100,
                ratingSum: 423,
                avgRating: 4.23,
                complaintCount: 14,
                complaintRate: 14 / 90,
                highRatedCount: 75,
                highRatedComplaintCount: 8,
                highRatedComplaintRate: 8 / 75,
                aspects: [
                  {
                    name: 'Качество сборки',
                    category: 'quality',
                    reviews: 60,
                    positive: 42,
                    neutral: 12,
                    negative: 6,
                  },
                  {
                    name: 'Автономность',
                    category: 'functionality',
                    reviews: 34,
                    positive: 20,
                    neutral: 4,
                    negative: 10,
                  },
                ],
              },
              sentiment: { positive: 72, negative: 18, neutral: 10 },
              negativePct: 33.3,
              issuesCount: 1,
            },
          },
    );
  if (p.endsWith('/products')) return route.fulfill({ json: { items: [product] } });
  if (p.endsWith('/analysis/runs')) return route.fulfill({ json: { items: [run], total: 1 } });
  if (p.endsWith('/analysis/runs/run')) return route.fulfill({ json: run });
  if (p.endsWith('/issues/groupings'))
    return route.fulfill({
      json: {
        items: [group],
        total: 1,
        page: 1,
        pageSize: 20,
        currentPublicationId: 'pub',
        publication: { id: 'pub', runId: 'run', run, createdAt: run.finishedAt },
      },
    });
  if (p.endsWith('/issues/groupings/history'))
    return route.fulfill({
      json: {
        items: [
          { id: 'pub', runId: 'run', action: { kind: 'automatic' }, createdAt: run.finishedAt },
        ],
      },
    });
  if (p.endsWith('/snapshots/s/evidence'))
    return route.fulfill({
      json: { items: [group.representatives[0]], total: 1, pageSize: 10, offsetUnit: 'utf16' },
    });
  if (p.endsWith('/diagnostics'))
    return route.fulfill({
      json: {
        status: 'ok',
        database: true,
        queue: true,
        worker: true,
        model: { action: 'Службы доступны.' },
      },
    });
  if (p.endsWith('/reports'))
    return route.fulfill({
      json: {
        items: [
          {
            id: 'report',
            title: 'Анализ отзывов: ReviewLens Pro',
            format: 'pdf',
            status: 'completed',
            productId: 'p',
            runId: 'run',
            createdAt: run.finishedAt,
          },
        ],
      },
    });
  if (p.endsWith('/reviews') && url.searchParams.get('rating'))
    return route.fulfill({
      json: {
        items: [],
        total: { 5: 58, 4: 22, 3: 9, 2: 7, 1: 4 }[url.searchParams.get('rating')],
        pageSize: 1,
        page: 1,
      },
    });
  if (p.endsWith('/reviews'))
    return route.fulfill({
      json: {
        items: [
          {
            id: 'r',
            text: 'Хороший товар, но крышка заедает. ' + 'Дополнительное описание. '.repeat(20),
            rating: 5,
            reviewDate: null,
            source: 'csv',
            analysisStatus: 'succeeded',
            evidence: [
              {
                id: 'mention',
                defect: 'Крышка заедает',
                quote: 'крышка заедает',
                quoteStart: 18,
                quoteEnd: 32,
                consequences: null,
                groupLinks: [
                  {
                    id: 's',
                    title: 'Крышка заедает',
                    productId: 'p',
                    runId: 'run',
                    publicationId: 'pub',
                  },
                ],
              },
            ],
            sentiment: 'positive',
            sentimentScore: 0.6,
            aspects: [{ name: 'Качество', sentiment: 'negative' }],
            issues: ['Крышка заедает'],
            productId: 'p',
            product: { id: 'p', name: productName },
            hiddenIssueId: null,
            createdAt: run.createdAt,
            analyzedAt: run.finishedAt,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    });
  if (p.endsWith('/analysis/timeseries'))
    return route.fulfill({
      json: {
        unknownDateCount: 1,
        buckets: Array.from({ length: 20 }, (_, i) => ({
          date: '2026-10-' + String(i + 1).padStart(2, '0'),
          positive: 8 + (i % 6),
          neutral: 2 + (i % 3),
          negative: 1 + (i % 4),
          succeeded: 20,
          complaintCount: 4,
          complaintRate: 0.2,
        })),
      },
    });
  if (p.endsWith('/analysis/provider'))
    return route.fulfill({
      json: {
        provider: 'local',
        model: 'fixture-model',
        concurrency: 1,
        contextTokens: 4096,
        responseFormat: 'json_schema',
      },
    });
  if (p.endsWith('/profile/stats')) return route.fulfill({ json: { uploads: 1, reports: 0 } });
  return route.fulfill({ json: { items: [], total: 0, pageSize: 10 } });
});
await page.goto(base + '/products');
await page.getByRole('heading', { name: 'Товары', exact: true }).waitFor();
// The selected product persists while authentication remains in memory.
await page.evaluate(() =>
  localStorage.setItem(
    'hia.selectedProduct',
    JSON.stringify({ state: { selectedProductId: 'p' }, version: 0 }),
  ),
);
await page.reload();
await page.getByRole('heading', { name: 'Товары', exact: true }).waitFor();
const results = [];
for (const theme of ['light', 'dark']) {
  await page.evaluate(
    (dark) => document.documentElement.classList.toggle('dark', dark),
    theme === 'dark',
  );
  for (const width of [1440, 768, 390, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of [
      'dashboard',
      'issues',
      'reviews',
      'products',
      'analytics',
      'upload',
      'reports',
      'profile',
    ]) {
      await page.goto(`${base}/${path}`);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      if (['dashboard', 'issues', 'reviews', 'analytics', 'reports'].includes(path)) {
        await page.getByLabel('Товар:', { exact: true }).selectOption('p');
        await page.getByLabel('Запуск анализа', { exact: false }).selectOption('run');
      }
      if (path === 'issues' && width < 1024)
        await page
          .getByRole('button', { name: /Качество: крышка заедает.*уникальных отзывов/ })
          .click();
      await page.waitForTimeout(200);
      const dimensions = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth,
        width: window.innerWidth,
        main: document.querySelector('main')?.scrollWidth,
        client: document.querySelector('main')?.clientWidth,
      }));
      assert(
        dimensions.doc <= width + 2 && dimensions.main <= dimensions.client + 2,
        `${theme}/${width}/${path} overflow ${JSON.stringify(dimensions)}`,
      );
      results.push({ theme, width, path, ...dimensions });
      if (
        [
          'dashboard',
          'issues',
          'products',
          'reviews',
          'analytics',
          'upload',
          'reports',
          'profile',
        ].includes(path) &&
        [1440, 390].includes(width)
      )
        await page.screenshot({ path: `${output}/${path}-${theme}-${width}.png`, fullPage: true });
    }
  }
}
await page.setViewportSize({ width: 1440, height: 1000 });
await page.goto(base + '/issues');
await page.getByLabel('Товар:', { exact: true }).selectOption('p');
await page.getByLabel('Запуск анализа', { exact: false }).selectOption('run');
await page.evaluate(() => (document.documentElement.style.zoom = '200%'));
assert(
  await page.evaluate(
    () =>
      document.documentElement.scrollWidth <= innerWidth + 2 &&
      document.querySelector('main').scrollWidth <= document.querySelector('main').clientWidth + 2,
  ),
  '200% CSS zoom overflow',
);
await page.screenshot({ path: `${output}/issues-zoom-200.png`, fullPage: true });
await page.evaluate(() => (document.documentElement.style.zoom = ''));
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(base + '/reviews');
await page.getByLabel('Товар:', { exact: true }).selectOption('p');
await page.getByRole('button', { name: 'Открыть навигацию' }).click();
const dialog = page.getByRole('dialog', { name: 'Навигация' });
await dialog.waitFor();
await page.keyboard.press('Shift+Tab');
assert(await dialog.evaluate((el) => el.contains(document.activeElement)), 'Drawer focus escaped');
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'detached' });
assert(
  await page
    .getByRole('button', { name: 'Открыть навигацию' })
    .evaluate((el) => el === document.activeElement),
  'Drawer focus was not restored',
);
await page
  .getByRole('button', { name: /Открыть отзыв:/ })
  .first()
  .click();
await page.getByRole('dialog', { name: 'Детали отзыва' }).waitFor();
assert.equal(await page.locator('mark').first().textContent(), 'крышка заедает');
await page.getByRole('link', { name: 'Открыть группу: Крышка заедает' }).click();
await page.getByRole('button', { name: 'Все группы этой публикации' }).waitFor();
await page.getByRole('button', { name: 'Все доказательства' }).click();
const filterRequest = page.waitForRequest(
  (req) => req.url().includes('/snapshots/s/evidence') && req.url().includes('context=high_rating'),
);
await page.getByLabel('Контекст доказательств').selectOption('high_rating');
await filterRequest;
await page.getByRole('button', { name: 'Все группы этой публикации' }).click();
assert(!page.url().includes('snapshotId='));
failStats = true;
await page.goto(base + '/dashboard');
await page.getByRole('alert').filter({ hasText: 'База временно недоступна' }).waitFor();
failStats = false;
await page.getByRole('button', { name: 'Повторить запрос' }).first().click();
await page.getByRole('alert').waitFor({ state: 'detached' });

// Long server-provided labels must wrap inside the application shell.
product.name = productName.repeat(12);
group.title = 'Повторяющаяся жалоба с длинным названием '.repeat(12);
for (const width of [1440, 390]) {
  await page.setViewportSize({ width, height: 1000 });
  for (const route of ['/products', '/issues']) {
    await page.goto(base + route);
    await page.getByRole('heading', { level: 1 }).waitFor();
    if (route === '/issues') await page.getByLabel('Товар:', { exact: true }).selectOption('p');
    assert(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= innerWidth + 2 &&
          document.querySelector('main').scrollWidth <=
            document.querySelector('main').clientWidth + 2,
      ),
      'Long server label overflow',
    );
  }
}
product.name = productName;
// Extra states: imports, aspect charts, account model controls, authentication.
for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const source of ['manual', 'parsing']) {
      await page.goto(base + '/upload?source=' + source);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      assert(
        await page.evaluate(
          () =>
            document.querySelector('main').scrollWidth <=
            document.querySelector('main').clientWidth + 2,
        ),
        'Import overflow',
      );
      await page.screenshot({
        path: output + '/upload-' + source + '-' + theme + '-' + width + '.png',
        fullPage: true,
      });
    }
    await page.goto(base + '/analytics');
    await page.getByLabel('Товар:', { exact: true }).selectOption('p');
    await page.getByRole('button', { name: 'Аспекты и жалобы', exact: true }).click();
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      theme === 'dark',
    );
    if (!(await page.locator('main').count())) {
      console.log('ASPECT ERROR', errors, await page.locator('body').innerText());
      await browser.close();
      process.exit(1);
    }
    assert(
      await page.evaluate(
        () =>
          document.querySelector('main').scrollWidth <=
          document.querySelector('main').clientWidth + 2,
      ),
      'Aspect chart overflow',
    );
    await page.screenshot({
      path: output + '/aspects-' + theme + '-' + width + '.png',
      fullPage: true,
    });
    for (const auth of ['login', 'register']) {
      await page.goto(base + '/' + auth);
      await page.getByRole('heading', { level: 1 }).waitFor();
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      assert(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2),
        'Auth overflow',
      );
      await page.screenshot({
        path: output + '/' + auth + '-' + theme + '-' + width + '.png',
        fullPage: true,
      });
    }
  }
}
assert.equal(errors.length, 0, errors.join('\n'));
await fs.writeFile(
  `${output}/results.json`,
  JSON.stringify(
    { checks: results, focusAndEscape: true, errorRetry: true, jsErrors: errors },
    null,
    2,
  ),
);
console.log(
  `Browser UI: ${results.length} page/theme/width combinations, modal focus/Escape/restore, API error/retry, no JavaScript errors. Screenshots: ${output}`,
);
await browser.close();
