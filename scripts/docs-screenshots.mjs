// Takes the README/docs screenshots from a running demo site.
//   node scripts/build-demo-site.mjs && (cd demo-site && python3 -m http.server 4500) &
//   node scripts/docs-screenshots.mjs http://127.0.0.1:4500
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const base = process.argv[2] ?? 'http://127.0.0.1:4500';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function shot({ repo, file, width = 1440, height = 810, pose, progress, scale = 2, settle = 3500 }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(`${base}/?repo=${repo}`);
  await page.waitForFunction(() => window.gitcity);
  await page.evaluate(
    ({ pose, progress }) => {
      const g = window.gitcity;
      g.stage.controls.autoRotate = false;
      g.stage.autoQuality = false;
      const r = g.city.radius;
      if (pose) {
        g.stage.camera.position.set(pose[0] * r, pose[1] * r, pose[2] * r);
        g.stage.controls.target.set(pose[3] * r, pose[4] * r, pose[5] * r);
      }
      if (progress !== undefined) {
        g.timeline.toggle(true);
        g.timeline.setProgress(Math.max(0, progress - 0.04));
      }
    },
    { pose, progress },
  );
  if (progress !== undefined) {
    // Let the playback run a little so contributor lights are mid-flight.
    await page.waitForFunction((p) => window.gitcity.timeline.progress >= p, progress, { timeout: 120000 });
    await page.evaluate(() => window.gitcity.timeline.toggle(false));
  }
  await page.waitForTimeout(settle);
  await page.screenshot({ path: `docs/${file}`, type: 'jpeg', quality: 86 });
  console.log('wrote docs/' + file);
  await page.close();
}

await shot({ repo: 'react', file: 'screenshot-react.jpg', pose: [0.95, 0.5, 1.05, 0.02, 0.0, 0] });
await shot({ repo: 'vue', file: 'screenshot-vue.jpg', pose: [0.55, 0.32, 0.7, -0.05, 0.02, 0] });
await shot({ repo: 'redis', file: 'screenshot-redis.jpg', pose: [-0.9, 0.55, 1.0, 0, 0, 0] });
await shot({ repo: 'redis', file: 'timelapse-redis.jpg', progress: 0.45 });
await shot({ repo: 'flask', file: 'mobile-flask.jpg', width: 390, height: 844, scale: 2 });
await browser.close();
