# Good morning ☕

All 9 phases are done, plus a self-review pass. Everything is on branch `claude/eager-goodall-k4uh2o`, with one commit per phase and a few fix-up commits. Nothing was published, deployed, or created outside the repo.

## Summary

**gitcity** (the npm name was free; see DECISIONS.md #1) turns a repo's history into a 3D night city:

- `npx gitcity` / `npx gitcity ./path` / `npx gitcity https://github.com/user/repo` (or `user/repo`)
- Zero runtime dependencies. The viewer is pre-bundled into `dist/viewer`, so it works offline.
- Districts = top-level folders (a folder holding over half the city gets split), building = file, height = √lines, footprint = log10(commits), color = language, dark lots = deleted files, neon crowns = tallest ~2.5%.
- Time-lapse with a growth-curve scrubber, date, and contributor lights flying to the files they change.
- Hover tooltip, click-to-fly, search (`/`), PNG 16:9 and 9:16, 10-second WebM with a watermark.
- Demo site with React, Vue, Redis and Flask, deployed by `.github/workflows/pages.yml` on push to `main`.
- 35 tests: parser, layout determinism and overlap, builder (renames, deletes, merges, caps, monorepo split, empty repo), CLI args, cloning, viewer replay.

## What works (verified here)

- Line counts at HEAD match `wc -l` on a merge-heavy test repo with renames and deletes.
- The same repo gives a byte-identical city.
- Synthetic repo with **50,000 commits / 18,932 files**: built in 137 s with 139 MB peak RSS. git takes 131 s of that (the synthetic pack has no deltas); my parser adds about 5 s. React (21.7k commits) takes 22 s.
- Viewer on the 20k-building city: CPU per frame is about 0.3 ms for height animation, 0.5 ms for picking, and 0.6 ms for a full replay. Everything is one instanced draw call.
- Empty repo, non-repo folder, missing folder, bad remote and submodules all fail gracefully or render an empty city.
- `npm pack`, then install the tarball, then `npx gitcity` serves the bundled viewer. Path traversal on the server returns 404.
- Switching demo repos and a full playback produce no console errors, and the replayed final state equals HEAD.
- PNG and WebM export work in headless Chromium (1920×1080 VP9).

## What's weak / not verified

1. **The 60 fps target is not measured on real hardware.** Only headless SwiftShader (software GL) was available. The architecture is built for integrated GPUs (one draw call, shader LOD, half-res bloom, auto quality drop), but please check fps on a real laptop.
2. **Portrait (1080×1920) export** leaves a lot of empty sky above the city (`docs/export-portrait-sample.jpg`). It needs a lower camera angle.
3. **JavaScript is amber, like the window lights**, so JS-heavy repos (React) look very orange. Consider another hue for JS in `src/core/languages.ts`.
4. **Video records in real time** (a MediaRecorder limit). On a slow GPU it drops to 720p, but it can still be choppy. Safari falls back to MP4 if it records at all.
5. **Large-repo parse time is git-bound.** Rename detection (`-M`) is on, and there is no `--since`/`--branch` option yet (good first issue #3).
6. Districts with thousands of tiny files (React `compiler/packages`) form a big uniform grid.
7. **No ESLint**; CI only typechecks (good first issue #1).
8. **GitHub Pages must be enabled once**: Settings → Pages → Source: *GitHub Actions*. The demo link in the README (`https://adywakes.github.io/Git-city/`) only works after merging to `main`.
9. The README has a GIF placeholder comment; record one from the time-lapse.

## Commands to test

```bash
cd Git-city
npm ci
npm test
npm run build
```

Run it on this repo, on any local repo, or on a remote one:

```bash
node dist/cli.js .
```

```bash
node dist/cli.js https://github.com/expressjs/express
```

```bash
node dist/cli.js vuejs/core --max-buildings 3000
```

Write city data only:

```bash
node dist/cli.js . --json /tmp/city.json
```

Exactly what users will get from npm:

```bash
npm pack && mkdir -p /tmp/gc && cd /tmp/gc && npm init -y && npm i ~/Git-city/gitcity-0.1.0.tgz && npx gitcity ~/Git-city
```

The demo site locally:

```bash
npm run build && node scripts/build-demo-site.mjs && cd demo-site && python3 -m http.server 4500
```

Then open http://127.0.0.1:4500/?repo=react (also `vue`, `redis`, `flask`).

Performance test on a big synthetic repo (generation takes about 4 minutes and ~1.2 GB):

```bash
node scripts/synth-repo.mjs /tmp/synth --commits 50000 --files 20000
```

```bash
node dist/cli.js /tmp/synth --max-buildings 20000
```

In the browser, press space to play, `/` to search, and use Share for PNG or video. Watch the frame rate in your browser's performance tools. The viewer object is at `window.gitcity` in the console (for example `gitcity.stage.quality`).

Files: decisions in `DECISIONS.md`, status in `PROGRESS.md`, screenshots in `docs/`.
