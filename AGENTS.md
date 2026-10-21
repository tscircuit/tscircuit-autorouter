# Capacity Node Autorouter Development Guide

## Commands

- Build: `bun run build`
- Start development server: `bun run start`
- Run tests: `bun test`
- Run specific test: `bun test tests/svg.test.ts`

> Don't format or lint the code.

> Do not edit README.md unless the user explicitly requests README changes.

## Validation Policy

- Run tests, builds, and focused checks locally by default.
- Use Blacksmith only for benchmark runs unless the user explicitly asks to use
  Blacksmith for another validation task.

## Visualization Debugging

When changing or reviewing solver `visualize()` / `preview()` output, use the
`tscircuit-visualization` skill.

Prefer existing graphics artifact tooling instead of ad hoc screenshots:

- Use `PipelineStageDebugRunner` for per-stage artifacts.
- Use `scripts/run-sample.ts --ai-visuals` to export PNG, SVG,
  GraphicsObject JSON, and per-step PNGs.
- If you need Pipeline 7 visuals colored by net instead of layer, use `--net-colors`.
- Inspect the generated PNGs before making visual changes.

For pipeline 7 first-stage visual debugging, use:

```bash
bun scripts/run-sample.ts \
  --pipeline 7 \
  --dataset srj18 \
  --sample 1 \
  --effort 0.1 \
  --stop-after-stage componentDetectionSolver \
  --ai-visuals \
  --net-colors \
  --out-dir /tmp/pipeline7-visuals
```

## Fallback Logic

> When a solver hits a state it can't explain, fix the root cause or throw. Do not add a fallback.

Fallback logic is an anti-pattern here and a common mistake when extending the solvers. A fallback is any code that lets the pipeline keep running after something went wrong instead of surfacing it: catching a thrown error and continuing as if it succeeded, `?? []` / `|| default` on data that should always exist, "if strategy X fails, silently try Y", or marking a solve `solved` when it actually failed. Because the pipeline keeps going, the result isn't a crash you can debug — it's a silently wrong board.

- **Don't**: `TinyHypergraphPortPointPathingSolver._step` catches the thrown error and calls `finishWithExistingSolverState`, which sets `solved = true; failed = false; error = null`. A `start regions not found` / `regions not found` error means region computation is broken upstream — fix why the region list is empty; do not add another branch that guesses around it.
- **Do**: `assertDefined(startRegion, 'Could not find start region for connection "..."')` in `buildHyperGraph.ts` — fail loud, named, specific.
- The "avoid throwing" note under Code Style applies to recoverable I/O at the edges, not to solver-internal invariants. A loud failure on bad input beats a plausible-looking wrong route.

## Code Style Guidelines

- Use **TypeScript** with strict typing enabled
- **Naming**: Use camelCase for variables/functions and PascalCase for
  classes/interfaces. A focused source file should match its primary export
  exactly (for example, `getNodeEdgeMap.ts` or `CapacityMeshEdgeSolver.ts`).
  Multi-export utility and type modules may use a descriptive camelCase name.
- **Imports**: Organize imports according to Biome rules (auto-organized when formatting)
- **Components**: Create React components with proper type definitions
- **Error handling**: Use try/catch for recoverable I/O at the edges; do not swallow solver-internal errors. See **Fallback Logic** above — throw on unexpected/invalid solver state rather than adding a fallback.
- **Formatting**: Use Biome for consistent formatting (2-space indentation, double quotes for JSX)
- **Comments**: Add meaningful comments for complex logic, avoid unnecessary comments
- **Export patterns**: Export classes/functions directly from their definition files
- Avoid over-abstraction. Prefer direct code until a helper removes real
  duplication or clarifies a genuinely complex operation.
- Do not create functions smaller than 6 lines.
- Define types near the start of new code so variables, function parameters,
  and return values have explicit types.
- Always define function return types in new code.
- Structure types so invalid states are not representable where practical.
- Make solver invariants required in the type system; use `OrThrow` helpers at
  boundaries where invalid external data must be rejected.
- Name shared metadata for its domain role, not its current producer (for
  example, `connectedTo`, not `obstacleConnectedTo`). Avoid prefixes; if one
  defines a category, apply it consistently to every member of that category.
- Keep diffs to the requested fix. Do not add precautionary or adjacent
  refactors without asking first.
- ONE TEST PER FILE
- Pass helpers only the fields they read, e.g.
  `opts: Pick<SimpleRouteJson, "layerCount" | "allowBlindAndBuriedVias">`
  instead of the whole `srj`.
- Give every non-obvious tuning constant a one-line comment with its unit and
  why that value (`MAX_SEGMENT_LENGTH = 0.5 // mm, max length between bends`).
- Don't use `Math.hypot` in new solver geometry. It has produced
  cross-platform differences; compute `Math.sqrt(dx * dx + dy * dy)`.
- Don't nudge thresholds with tiny epsilons, extra caches, or identity-tracking
  layers to make one board pass. If you think one is needed, explain why in the
  PR and ask first.

## Write Like a Human

Reviewers have to read everything you produce. Code and PR text that reads like
a generated audit log gets rejected or ignored, even when the fix is right.

- Code should look like the surrounding code. Short names, no stacked guards
  for states that can't happen, no comments that restate the line below.
- A PR description is: what was broken, what you changed, how you know it
  works. Aim for under 15 lines plus one before/after image or table.
- Don't paste validation inventories ("24 focused tests, 1,738 assertions"),
  lists of every command you ran, or hedging like "no claim is made that...".
  Say what passed and what still doesn't, plainly.
- When you push follow-ups, rewrite the description to describe the PR as it
  is now. Don't append "Follow-up investigation" sections.
- Explain the motivation, especially when a change modifies preloaded or
  existing routes. Reviewers asked "what's the motivation?" on #2924.

## Proving a Change

- Show a bug fix through the pipeline that had the bug. A utility-only test
  isn't enough: "i'm not sure this fix does anything because a pipeline wasn't
  used" (#3054). Add a bug report test that fails before the fix.
- Performance claims need clear before/after numbers. Unclear gains get
  changes requested (#3135).
- Benchmarks: add memory next to runtime, as rows in the existing comparison
  table, not a horizontal layout (#2866). Call out P50 memory increases
  (#2927).
- If a snapshot changes, compare DRC errors and via counts on the same input
  and say if they got worse. Don't call a refreshed snapshot an improvement
  without that.
- Get CI green before asking for review (#2770).

## Architecture

The codebase follows a modular architecture with solvers handling different aspects of autorouting. The main export is the `AutoroutingPipelineSolver` which orchestrates the routing process and contains all the stages.

## Writing tests

When writing visualization snapshot tests, read the `tscircuit-visualization`
skill first. Do not set timeouts in test code (no `test("...", fn, 300_000)`); CI controls test timeouts.
When running tests locally, pass a large timeout, such as `--timeout 9999999`.

When asked to update snapshots, run
`BUN_UPDATE_SNAPSHOTS=1 bun test --timeout 9999999`. If only specific tests are
failing because of a change, update only those failing tests. Do not spend time
updating every test.
