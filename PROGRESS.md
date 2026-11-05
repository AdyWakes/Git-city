# Progress

## Done
- Phase 1: scaffold (TypeScript CLI, Vite viewer, Vitest, CI workflow)
- Phase 2: streaming `git log -z --raw --numstat` parser (`src/core/parser.ts`), git helpers (`src/node/git.ts`), tests
- Phase 3: city model (`src/core/builder.ts`), deterministic layout (`src/core/layout.ts`), format (`src/core/format.ts`), tests
- Phase 4: CLI (`src/cli.ts`, zero deps), local server, Three.js viewer (`viewer/src`): instanced buildings with procedural window shader, bloom, fog, district plates, street lights, labels, hover tooltip, click-to-fly, search
- Phase 5: time-lapse (`replay.ts`, `timeline.ts`, `walkers.ts`): play/pause (space), growth-curve scrubber with year marks, speed, contributor lights with trails
- Phase 6: export (`viewer/src/export.ts`): PNG 1920x1080 / 1080x1920, 10s WebM with watermark
- Phase 7: remote cloning (`src/node/clone.ts`) with progress, temp-dir cleanup, `--keep`
- Phase 8: demo site (`demo/`, `scripts/build-demo-*.mjs`, `.github/workflows/pages.yml`), synthetic repo generator
- Phase 9: README, CONTRIBUTING
- Self-review: label/UI overlap, per-frame reflow, redundant picking, submodules, empty repos, monotonic timeline dates, palette balance, mobile layout, GPU resource disposal on repo switch, Replay test; screenshots in `docs/`; MORNING.md

## Next (ideas, not started)
- Portrait export framing (lower camera so the skyline fills the frame)
- Real-GPU fps measurement on an integrated-graphics laptop (only headless SwiftShader was available)
- Good first issues listed in README

## Known issues
- See "What's weak" in MORNING.md.
