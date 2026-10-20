import fs from 'node:fs/promises';
import { renderReport } from './services/report-renderer.js';
const [input, output] = process.argv.slice(2);
try {
  const { format, title, snapshot } = JSON.parse(await fs.readFile(input, 'utf8'));
  await renderReport(output, format, title, snapshot);
  process.send?.({ peakRssBytes: process.resourceUsage().maxRSS * 1024 });
} catch { process.exitCode = 1; }
