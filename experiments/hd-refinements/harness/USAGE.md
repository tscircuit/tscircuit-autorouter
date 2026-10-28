# HD refinement source-arm experiments

These two independent CI jobs each measure all16 dataset18 and26 dataset24 boards
on Pipeline9 in four portfolio source checkouts (168 fresh processes) and five
legalization source checkouts (210 fresh processes). The complete arm matrix was
prespecified before any refinement benchmark outcomes.
No solver mode is injected through the environment or constructor. Every arm uses
one common refinement observer. Worker SHA256 is
`1a2e2bf44ffb46d2bb52f0926b2af4c96684dca348d96acd79c5ed8da53a80f3`.
It adds exact source-SRJ and scenario hashes before timed solving, plus shallow
raw-constructor rule declarations. The previous worker was
`a38701372b453e939ec3698703fec73a896b822214a957b8301e978088890858`.
Raw HD-constructor hashing and synchronous phase/clock observation are unchanged.
The source SRJ is exactly the loaded scenario after metadata migration and effort
override, before runTask can mutate it. Parent timeouts retain its started-event
identity even when the synchronous solver prevents timer heartbeats. This observer
change is recorded; do not pool timings with previous observer cohorts.

Copy this complete directory to `experiments/hd-refinements/harness` in each
refined PR. Replace the prior experiment-specific paired workflow with its
template from the accompanying `workflows` directory. Fill one ablation placeholder
for portfolio (`HD_EAGER_SHA`) or both legal ablations (`HD_COMPRESSION_SHA` and
`HD_FULL_SHA`) before publishing. Each must be a published exact40-character
commit that changes only the intended factory default from the refined source.
The workflow uses the exact PR head as the refined default arm and binds the configuration
at runtime. Unbound placeholders fail validation; branch names are never accepted.

Portfolio arms are baseline637, historical CPU-timed race c7f2715 (thread CPU preferred, process CPU/elapsed fallback),
and corrected eager/lazy grid setup. Eager versus lazy isolates grid setup after physical
contract corrections. Legalization arms are baseline637, historical full8115,
refined compression-only, refined full, and refined selective. Historical full is
explicitly an older implementation; refined full isolates current clearance and
safety checks from selective stopping. New full/compression/selective differ only
by their real factory defaults, with separate exact source commits.

Both jobs install once from `dependencies/package.json` and the archived
`dependencies/bun.lock`, using Bun1.4.3 with `bun install --frozen-lockfile`.
Expected lock SHA256 is
`261a3861619cd4aa6265d2c9b75825a49196002d59ad665dddd69c67378ed1ee`.
The generating manifest is also pinned to SHA256
`0b42899deea4cd0f4ba73a46fe2e948758bb05af9da6c1541ffd116141b36d6c`.
Every source arm's dependency sections must equal the archived manifest. Every
checkout links the same installed node_modules tree. The exact lock, resolved
package listing, all protocol files/hashes, refs and source-tree hashes are saved.
No dependency resolution occurs in individual source checkouts.

The runner must provide at least56GiB effective and currently available RAM.
The controller selects six affinity-pinned lanes if observed affinity/numeric CPU
quota permit, otherwise three; fewer than three fails. Missing cgroup quota is
recorded as unavailable, not invented. Every sample uses one routing thread,
effort1 and360 seconds of routing wall time, with a separate120-second import cap.
If both effective and available RAM are at least80GiB, global admission and
observed-RSS guard are64GiB (`refinement-64GiB`); otherwise they are48GiB
(`refinement-48GiB`, minimum56GiB). The selection and observed capacities are
recorded and independently checked; ratios from different profiles are not pooled.
The unchanged scheduler
uses the same static per-board reservation for every arm, derived from the maximum
RSS observed across all nine archived earlier cohorts plus historical observations.
Reservations are margins, not allocation caps. Unknown future memory growth is
still possible. The static table requires no prior artifact paths at runtime.

An explicit seed shuffles board order; rotating arm order balances initial
position within board groups. The complete planned queue and hash are saved.
Memory admission may scan ahead with bounded bypasses, so the realized start/CPU
order in events.jsonl is authoritative. This is one exploratory observation per
board/arm, not a repeated randomized confidence estimate. The two independent
jobs have separate baselines and must not pool timing ratios across runners.

Reproduction (CI runner only):

```sh
python3 experiments/hd-refinements/harness/configure_matrix.py \
  --profile portfolio --head-sha EXACT_REFINED_HEAD \
  --derived-sha EXACT_EAGER_COMMIT --out /tmp/hd-matrix.json
python3 experiments/hd-refinements/harness/multiarm_ci.py \
  --root /path/to/checkouts --out /path/to/fresh-results \
  --deps /path/to/fresh-dependencies --config /tmp/hd-matrix.json
```

Checkout directory names must equal configured arm IDs. The output and dependency
directories must be fresh. The lower-level driver permits interruption/resume
only with the exact source/config/worker/driver/dependency/resource/order
fingerprint. A result from a changed protocol cannot be reused.

`multiarm-summary.json` retains direct predeclared before/after contrasts, exact
sample IDs in each stage cohort, common-clean full-board timing and finite paired
wire/via coverage. Strict raw-constructor HD ratios require identical original
HD-constructor hashes and completion on both sides. Separate source-SRJ HD ratios
require identical pre-solve source board hashes and both stages completed. Neither
includes censored observations. Each downstream stage has separate raw-constructor
and source-SRJ cohorts. Source-board equality does not imply equivalent derived
clearance/configuration: old full legalization omitted a declared hole-clearance
rule that the refined implementation supplies. Raw hashes, field names and rule
declarations remain visible; no constructor input is normalized to hide this.
New full/compression/selective should still have equal raw inputs. Failure/unclean outcomes receive360-second scores separately from
actual elapsed time. Output hashes and diagnostic counters allow eager/lazy work
parity checks; grid setup/time counters are expected to differ and parity is
not assumed from aggregate totals alone. Clean means the existing benchmark's
relaxed DRC. Historical worker wire scalars can be missing; missing values are
never counted as zero.

Full raw records, task files, heartbeats, stdout/stderr, HD captures, source hashes
and frozen protocols are uploaded even when controller validation fails. The job
also prints a numbered32KB-chunk gzip/base64 summary with gzip and payload SHA256.
To reconstruct from a saved plain log or raw GitHub job-log tool response:

```sh
python3 experiments/hd-refinements/harness/extract_refinement_summary.py \
  job-log.json --out extracted-summary
```

Missing/conflicting chunks or incorrect hashes fail extraction and preserve the
original incomplete log. `ci.complete` means all168 portfolio or210 legalization
authenticated records were collected; it does not mean every board solved or passed DRC.

Local infrastructure verification (no solver measurements):

```sh
cd experiments/hd-refinements/harness
python3 -m unittest discover -p 'test_*.py'
```

The source-context helper has a pure Bun unit test (no solver construction):

```sh
bun test problem_context.test.ts
```

For legalization configuration, add `--full-sha EXACT_REFINED_FULL_COMMIT` and
use `--profile legalization`; its derived SHA is the compression-only commit.
