# Decisions log

Choices made autonomously while building, with the reasoning, so they can be revisited.

1. **Name: `gitcity`.** Checked npm on 2026-11-05: `gitcity`, `git-city` were both unpublished (`repocity` and `commitcity` are taken). `gitcity` matches the working name and the repo, so it stays. Nothing was published.
2. **Zero runtime dependencies for the CLI.** Arg parsing, the static server and browser opening are hand-written on Node built-ins so `npx gitcity` installs in a second. Three.js and Vite are dev dependencies; the viewer is pre-bundled into `dist/viewer`.
3. **Typecheck instead of ESLint** in CI to keep the toolchain small (`tsc --noEmit` on both the CLI and viewer projects). ESLint is listed as a good first issue.
