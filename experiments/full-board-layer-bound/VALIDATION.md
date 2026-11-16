# Matched last-layer-bound experiment

This is a benchmark-only branch. It does not change the autorouter/Tiny production pin, board source, routing rules, iteration caps, effort, deadlines, or completion assessment.

The setup job resolves AR1103's exact source manifest once with Bun1.4.3, saves the new global lock and complete dependency hashes, and clones that graph. It atomically replaces only the one reviewed Tiny source file in the candidate copy. Both packages use `bun run build`, including the official Bun/Node generated workers and tsup declarations/maps. Diagnostic worker builds add only external source maps and must emit byte-identical worker code after removing only the trailing sourceMappingURL/debugId metadata comments. Every mapped source must come from the corresponding source lane and match its real file. Only the frozen Tiny source and generated worker wrappers may differ.

The setup artifact contains both complete dist packages, generated workers, the global lock/provenance and the common external production dependency closure installed with that same frozen lock. Normal Actions artifact upload/download preserves this new benchmark output; a tar archive preserves internal symlinks and file modes.

Board jobs reuse the frozen published Main3196/Core2389/Eval1783 runtime and checks278. Only the complete AR package changes to its explicit source-control/candidate build, with separate neutral package parents and labeled manifest entries. ICE original, Glider spaced and iMX6 spaced run control→candidate sequentially on the same 8-vCPU ARM VM. Existing full-board budgets remain900s observation/960s hard/180s assessment. All authored parts, nets, pours and phase configurations are retained. A source-control mismatch against available published3196 counts, physical net names, phase/blocker and coarse configuration evidence blocks the candidate lane and its attribution. Full published SRJ/circuit hashes were not decoded and are explicitly unavailable.

Dataset18 restores the global frozen source graph once, makes its own candidate copy, restores the same official generated workers, and invokes the unchanged `runSameMachineBenchmarks.ts` sequentially with `--pipeline 9 --dataset 18 --concurrency 4 --threads 1`. No worker, solver-effort or iteration budget is increased.

Default dispatch and a branch push run only setup/build provenance. No board routes run by default. After source review and build proof:

```sh
gh workflow run full-board-layer-bound.yml --repo tscircuit/tscircuit-autorouter --ref bench/full-board-layer-bound-3196 -f validation=build_only
gh workflow run full-board-layer-bound.yml --repo tscircuit/tscircuit-autorouter --ref bench/full-board-layer-bound-3196 -f validation=boards_and_dataset18
```

No local dependency install, official AR build, full-board solve, push or dispatch was performed while preparing this branch. Local checks cover syntax/static contracts only; the first remote build validates the bundler map/worker provenance assumptions. Timeouts and incomplete or dirty cases remain failures to complete, not gains.
