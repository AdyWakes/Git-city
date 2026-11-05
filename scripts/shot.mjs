// Dev/doc helper: node scripts/shot.mjs <url> <out.png> [width] [height] [waitMs] [js-to-eval]
import { createRequire } from 'node:module';
// Uses a globally installed Playwright when present (CI installs it explicitly).
const { chromium } = createRequire(import.meta.url)('playwright');
const [url, out, w = '1600', h = '900', wait = '4000', js] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForFunction(() => window.gitcity, null, { timeout: 30000 }).catch(() => logs.push('timeout waiting for app'));
if (js) await page.evaluate(js).catch((e) => logs.push("eval: " + e.message));
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
console.log(logs.join('\n'));
await browser.close();
