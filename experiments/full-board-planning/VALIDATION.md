# Matched full-board planning experiment

This private benchmark branch selects one reviewed AR planning fix. The manifest stays `frozen:false` until its exact payload/preimage/postimage and focused review are complete. The held weighted Tiny payload is removed; Tiny remains at AR1103’s original8e5807 pin. No layer-pricing change is included.

The manifest explicitly chooses exactly one `patchTarget`: `autorouter` applies relative `lib/...` files only to the candidate AR source tree and requires byte-identical dependency graphs; `tiny` supports the prior dependency-overlay mechanism only when explicitly selected. One experiment cannot mix targets. Every bundled changed module must match its exact before/after source hash; all other mapped sources and generated workers retain the proven strict audits.

Setup uses normal within-Actions download from successful build-only run43840051309. It extracts ONLY the source-base `bun.lock` and control dependency inventory, never the held candidate package, payload or generated workers. The restored lock must be exactly0a3887cace32cc804a5bf0ccdd8c4a5936cb81f8785c1e3b3372076468d0d322. Bun1.4.3 restores it with `--frozen-lockfile`; the existing Sharp initializer runs before complete byte inventory/copy. No new range resolution occurs. Both NEW packages then use the official worker-inclusive `bun run build`, followed by the selected existing integration tests without snapshot refresh.

The proven private Bun install config, Sharp initialization, omitted-upstream-source-map attestation, exact worker-code comparison after trailing map metadata removal, neutral Main/Core package parents and schema-correct runtime adapter are retained. Main3196/Core2389/Eval1783/checks278 remain published and unchanged; complete AR source-package overrides are explicitly labeled.

The early cases remain ICE original, Glider spaced and iMX6 spaced, running source-control→candidate sequentially on each8-vCPU ARM VM. Existing900s/960s/180s observation/hard/assessment budgets and authentic source/rules remain unchanged. Available published-control functional parity gates attribution. The unchanged original16-case Dataset18 controller requests4 workers and1 routing thread; its actual worker count is recorded. The prior run selected3 under its existing memory guard. No worker budget is lowered or solver budget raised.

Push/default dispatch is build-only. `boards_only` and `boards_and_dataset18` are explicit later gates. No push, dispatch, local install or official local build is authorized while the candidate manifest is pending.

```sh
gh workflow run full-board-planning.yml --repo tscircuit/tscircuit-autorouter --ref bench/full-board-planning-3196 -f validation=build_only
gh workflow run full-board-planning.yml --repo tscircuit/tscircuit-autorouter --ref bench/full-board-planning-3196 -f validation=boards_and_dataset18
```
