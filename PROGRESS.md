# Progress

## Done
- Phase 1: scaffold (TypeScript CLI, Vite viewer, Vitest, CI workflow)
- Phase 2: streaming `git log -z --raw --numstat` parser (`src/core/parser.ts`), git helpers (`src/node/git.ts`), tests

- Phase 3: city model (`src/core/builder.ts`), deterministic layout (`src/core/layout.ts`), format (`src/core/format.ts`), tests
- Phase 4: CLI (`src/cli.ts`, zero deps), local server, Three.js viewer (`viewer/src`): instanced buildings with procedural window shader, bloom, fog, district plates, street lights, labels, hover tooltip, click-to-fly, search

## Next
- Phase 5: time-lapse (play, scrubber, contributor lights)

## Known issues
- none yet
