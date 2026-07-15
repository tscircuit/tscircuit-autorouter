# Capacity Node Autorouter Development Guide

## Commands

- Build: `bun run build`
- Start development server: `bun run start`
- Run tests: `bun test`
- Run specific test: `bun test tests/svg.test.ts`

> Don't format or lint the code.

## Validation Policy

- Run tests, builds, and focused checks locally by default.
- Use Blacksmith only for benchmark runs unless the user explicitly asks to use
  Blacksmith for another validation task.

## Debugging Git Dependencies Locally

When a bug may be inside a Git dependency, clone that dependency locally and
temporarily replace its existing Git package spec in `package.json` with a path:

```json
{
  "package-name": "path/to/local/clone"
}
```

Then run `bun install` so imports resolve to the local clone. Keep the dependency
name unchanged. This direct Git-spec-to-path substitution is intended for
packages already installed from Git; do not assume it works for registry or
other non-Git dependencies. Restore the pinned Git commit before finishing
unless the task explicitly requires keeping the local link.

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

## Exact-Geometry DRC Candidate Ranking

When debugging `exactGeometryDrcForceImproveSolver`, do not treat a lower DRC
issue count as proof that a candidate is better. Compare the error categories,
`issueScore`, and the geometry before and after the accepted candidate.

`fixtures/bug-reports/bugreport74-8499df` demonstrates the failure mode. At the
reported iteration 4030 to 4031 transition (4058 to 4059 when reproduced without
cache), the baseline `GlobalDrcForceImproveSolver` previously accepted a
broad-repulsion candidate because `isBetterDrcSnapshot` prioritized issue
count. The candidate changed two trace-clearance errors with a combined
`issueScore` of `0.066` into one accidental trace-to-trace contact with an
`issueScore` of `1`. The count dropped from two to one while the geometry and
severity became much worse.

The relevant diagnostic stats are
`globalDrcForceImproveBroadForceAccepted: true` and
`globalDrcForceImproveTargetedForceAccepted: false`. Inspect the broad-force
candidate and every comparison that selects it. Before the fix, both the inner
solver and the branch portfolio could admit the same destructive candidate. A
DRC candidate must never be considered improved merely because it replaces
several clearance violations with fewer overlaps, shorts, or accidental
contacts. Rank maximum per-error severity before aggregate `issueScore`; using
only the aggregate can still prefer one contact over many tiny clearances whose
combined score exceeds the contact's score.

## Fallback Logic

> When a solver hits a state it can't explain, fix the root cause or throw. Do not add a fallback.

Fallback logic is an anti-pattern here and a common mistake when extending the solvers. A fallback is any code that lets the pipeline keep running after something went wrong instead of surfacing it: catching a thrown error and continuing as if it succeeded, `?? []` / `|| default` on data that should always exist, "if strategy X fails, silently try Y", or marking a solve `solved` when it actually failed. Because the pipeline keeps going, the result isn't a crash you can debug — it's a silently wrong board.

- **Don't**: `TinyHypergraphPortPointPathingSolver._step` catches the thrown error and calls `finishWithExistingSolverState`, which sets `solved = true; failed = false; error = null`. A `start regions not found` / `regions not found` error means region computation is broken upstream — fix why the region list is empty; do not add another branch that guesses around it.
- **Do**: `assertDefined(startRegion, 'Could not find start region for connection "..."')` in `buildHyperGraph.ts` — fail loud, named, specific.
- The "avoid throwing" note under Code Style applies to recoverable I/O at the edges, not to solver-internal invariants. A loud failure on bad input beats a plausible-looking wrong route.

## Code Style Guidelines

- Use **TypeScript** with strict typing enabled
- **Naming**: Use kebab-case for filenames, camelCase for variables/functions, PascalCase for classes/interfaces
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
- ONE TEST PER FILE

## Architecture

The codebase follows a modular architecture with solvers handling different aspects of autorouting. The main export is the `AutoroutingPipelineSolver` which orchestrates the routing process and contains all the stages.

## Writing tests

When writing visualization snapshot tests, read the `tscircuit-visualization`
skill first. Do not set timeouts in test code; CI controls test timeouts.
When running tests locally, pass a large timeout, such as `--timeout 9999999`.

When asked to update snapshots, run
`BUN_UPDATE_SNAPSHOTS=1 bun test --timeout 9999999`. If only specific tests are
failing because of a change, update only those failing tests. Do not spend time
updating every test.
