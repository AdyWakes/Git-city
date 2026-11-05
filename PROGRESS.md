# Progress

## Done
- Phase 1: scaffold (TypeScript CLI, Vite viewer, Vitest, CI workflow)
- Phase 2: streaming `git log -z --raw --numstat` parser (`src/core/parser.ts`), git helpers (`src/node/git.ts`), tests

- Phase 3: city model (`src/core/builder.ts`), deterministic layout (`src/core/layout.ts`), format (`src/core/format.ts`), tests
- Phase 4: CLI (`src/cli.ts`, zero deps), local server, Three.js viewer (`viewer/src`): instanced buildings with procedural window shader, bloom, fog, district plates, street lights, labels, hover tooltip, click-to-fly, search
- Phase 5: time-lapse (`viewer/src/replay.ts`, `timeline.ts`, `walkers.ts`): play/pause (space), scrubber with growth curve + year marks, speed, contributor lights with trails, labels appear with their districts
- Phase 6: export (`viewer/src/export.ts`): PNG 1920x1080 / 1080x1920 with title, district labels and watermark; 10s WebM time-lapse via MediaRecorder with slow orbit, date and watermark (720p fallback on slow GPUs)
- Phase 7: remote cloning (`src/node/clone.ts`): URLs, `git@` SSH, `github.com/x/y` and `owner/repo` shorthand; bare full clone with progress bar; temp dir removed right after parsing (`--keep` to retain)
- Phase 8: demo site: `demo/data/*.json` (react, vue core, redis, flask; 5000-building cap), `demo/manifest.json`, `scripts/build-demo-data.mjs`, `scripts/build-demo-site.mjs`, `.github/workflows/pages.yml` (deploys on push to main; manual run can regenerate data). Synthetic repo generator `scripts/synth-repo.mjs`
- Phase 9: README (pitch, demo link, usage, mapping, performance, architecture, contributing, 5 good first issues), CONTRIBUTING.md

## Next
- Self-review: performance, polish, edge cases; screenshots into docs/; MORNING.md

## Known issues
- none yet
