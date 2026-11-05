// Dev helper: exercises PNG + video export in headless Chromium and saves the downloads.
// node scripts/test-export.mjs <url> <outdir>
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, outDir = '.'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, acceptDownloads: true });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('[console]', m.text()));
await page.goto(url);
await page.waitForFunction(() => window.gitcity);
await page.waitForTimeout(1500);
for (const kind of ['png-wide', 'png-tall', 'video']) {
  const t = Date.now();
  const dl = page.waitForEvent('download', { timeout: 120000 });
  await page.click('#export-btn');
  await page.click(`[data-export="${kind}"]`);
  const d = await dl;
  const path = `${outDir}/${d.suggestedFilename()}`;
  await d.saveAs(path);
  console.log(kind, path, `${Date.now() - t}ms`);
}
await browser.close();
