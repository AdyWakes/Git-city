# Progress

## Done
- Phase 1: scaffold (TypeScript CLI, Vite viewer, Vitest, CI workflow)
- Phase 2: streaming `git log -z --raw --numstat` parser (`src/core/parser.ts`), git helpers (`src/node/git.ts`), tests

- Phase 3: city model (`src/core/builder.ts`), deterministic layout (`src/core/layout.ts`), format (`src/core/format.ts`), tests
- Phase 4: CLI (`src/cli.ts`, zero deps), local server, Three.js viewer (`viewer/src`): instanced buildings with procedural window shader, bloom, fog, district plates, street lights, labels, hover tooltip, click-to-fly, search
- Phase 5: time-lapse (`viewer/src/replay.ts`, `timeline.ts`, `walkers.ts`): play/pause (space), scrubber with growth curve + year marks, speed, contributor lights with trails, labels appear with their districts

## Next
- Phase 6: export PNG (1920x1080, 1080x1920) and 10s WebM with watermark

## Known issues
- none yet
