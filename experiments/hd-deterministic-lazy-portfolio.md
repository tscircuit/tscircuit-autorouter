# Deterministic deferred grid setup

Pipeline9 now uses `portfolioMode: "lazy"`. It retains the existing deterministic
fitness policy and defers only A01/A03 grid allocation where the exact post-setup
iteration cap can be certified. CPU timing does not select, promote, terminate or
budget candidates in this mode. The earlier timing-based race remains available
only as an explicit research mode; its reports remain historical evidence.

## Modes and comparison boundaries

| Mode | Scheduling and initialization | Candidate physical contracts |
| --- | --- | --- |
| `legacy` | Original eager fitness policy | Original A01 output and A03 eligibility |
| `eager` | Original eager fitness policy | Original A01 output and A03 eligibility |
| `lazy` | Same policy as `legacy`, certified deferred grid setup | Original A01 output and A03 eligibility |
| `research-race` | Historical CPU-clock race and its bounded allocation | Endpoint-preserving A01; A03 only at requested width 0.1 mm |

The generic portfolio defaults to `legacy` for existing callers. The Pipeline9
regular-node factory explicitly chooses `lazy`, and workers use that same factory.
The historical `selectivePortfolio: true` alias selects `research-race`; combining
it with an explicit deterministic mode throws. An unknown mode also throws.

`legacy`, `eager` and `lazy` retain candidate order, fitness, iteration limits,
adaptive expansion, A01 output, A03 eligibility, winners, routes and work. `eager`
versus `lazy` isolates initialization. The endpoint-preserving A01 wrapper and
requested-width A03 restriction remain confined to `research-race`; retaining
them in the deterministic modes would change the search policy.

The legacy A03 kernel produces 0.1 mm intermediate topology proposals even when
the requested node width is 0.15 or 0.2 mm. Later `TraceWidthSolver` assigns widths
for routes with a resolved connection or root-connection `nominalTraceWidth`.
A focused regression checks an actual A03 winner, unchanged legacy/eager/lazy
geometry and work, and its conversion to final 0.2 mm wire points with a 0.15 mm
minimum. This does not certify every A03 output: routes without a resolved nominal
width retain their existing width in that pre-existing pipeline path. This setup
experiment preserves that limitation rather than changing physical-width policy.

## Exact setup certificate

A01/A03 instances are still constructed in the original order, retaining their
public class identity and solver names. Native and closed-form constructors stay
eager: they can already solve, fail, or charge iteration work. In particular,
PriorityDAG's constructor work and native-family allocation cannot be represented
by an empty placeholder. A13 already defers grid setup in the original policy.

The pinned A01/A03 budget function has a natural lower bound:

```
requested = max(1, constructor MAX_ITERATIONS)
naturalMinimum = min(requested, clamp(round(requested *0.2),150000,2000000))
```

If the portfolio's cap is no larger than that bound, `min(naturalBudget,
portfolioCap)` is exactly the portfolio cap without allocating the grid. For the
normal 100M constructor request, the natural minimum is 2M. Larger uncertified caps
remain eagerly initialized. This is an explicit optimization eligibility limit,
not a recovery strategy after a failed solve.

Deferral also requires the known pinned constructor and unchanged `setup`/`_setup`
methods and writable ordinary `setup`/`getOutput` descriptors, the factory's
fixed cell/border recipe, finite valid node geometry and
physical parameters, unique valid layers with every terminal on an available
layer, and no custom penalty callback or maximum-cell restriction. Unsupported
shapes/overrides execute setup eagerly, preserving exceptions and failure states
even if another constructor has already found a route. No setup exception is
caught and converted into a usable candidate.

At first selection, setup receives its **original constructor MAX request**.
The advertised small cap must not be fed back into the kernel's budget formula.
After setup, the implementation checks the exact cap, setup completion, zero work,
zero progress and unchanged unsolved/unfailed state, then reapplies the cap. A
certificate violation throws. Direct candidate `step()`/`setup()` calls also take
this path. Explicit `getOutput()` or public debug-getter inspection materializes only that
candidate, then restores its original methods/getters. Inspecting the selected
best candidate also materializes it. Existing output methods therefore receive
the same initialized state; inspection pays the corresponding setup cost.

The original initial `g/f` are computed before setup, with `h=0`; adaptive A01
seeds calculate fitness after budget initialization. Both orders remain unchanged.
The same `MIN_SUBSTEPS=100`, fitness functions, first-match ties, candidate order,
tracked work, expansion budget and limits remain. A known deferred candidate has
zero progress; this avoids reading A03's uninitialized solved-map getter without
changing the eager value. There is no reduced failed-search allocation.

The certificate is specific to the pinned kernel source. Changing that dependency
requires auditing the bound, recipe and setup side effects again.

## What this removes—and what it does not

An unselected certified candidate never allocates its grid, owner arrays, search
arenas or setup-only connection structures. Candidates that are eventually selected
pay their normal setup cost later. Deferring setup can lower live allocation and
GC pressure when a winner arrives before the entire portfolio is selected.

This refinement still constructs all ordinary candidate objects, prepares native
and geometric strategies, and runs the same low-level searches and unsuccessful
seed work. It does not remove search iterations, change growth order, fix the
remaining drill/NPTH-rule context gaps, or legalize grown geometry. Large/unsupported
setups remain eager; if every candidate is selected, little allocation work may be
removed. The certificate itself also costs work. No previous 23% or dataset HD
saving is claimed to survive this narrower change before measurement.

## Cache domains and diagnostics

`legacy` uses the original schema4 cache key fields. The other modes add explicit
mode plus policy version4 for deterministic eager/lazy modes and version3 for the
research race; research timing mode is also included. Eager/lazy keys cannot reuse
the superseded corrected-policy version3 entries. Deterministic eager,
lazy, historical legacy and clock-race entries cannot cross-hit. Legacy and
implicit-default keys remain equivalent. No global cache is disabled for routing.

`portfolioLazy*` and `portfolioEager*` numeric diagnostics count attempts, deferred,
materialized, unmaterialized and eager grid setups, solved/unknown attempts and A03
exclusions. Lazy per-attempt stats expose those setup counts. These are allocation
counts, not deleted search work or runtime savings. No per-attempt clock is used
in the deterministic path.

## Focused validation

Focused tests compare every dispatch's candidate fitness, work and limits through
adaptive expansion, including a sole winning A01 seed 5. Real node tests compare
complete route JSON and connectivity at requested widths 0.1, 0.15 and 0.2 mm.
Constructor-success/failure, charged PriorityDAG setup, budget restoration across
efforts, unsupported-domain eager setup, setup exceptions, cache boundaries and
clock independence have dedicated checks. The clock-independence test makes all
policy clock reads throw, while deterministic eager/lazy routes still agree.

The native Bun worker micro check runs two actual independent batches and compares
complete route metadata, work, counters and outcomes without rounding, sorting or
ID replacement. Its distinct net identities provide equally cold cache contexts.
A separate [repeated-context counterexample](hd-lazy-cache-context-counterexample.json)
also fails under the corrected eager twin: serial cached native routes retain a prior node's `regionId`, while fresh
workers return the current node ID. Geometry/work/counters match in that case. The
counterexample is preserved separately; this refinement does not rebase the shared
native cache or claim universal worker parity from the cold-context micro test.
The existing full sample001 native-four-worker test passed at `c34c3d93c000abfe610899f24ac4271574a16222`:
one test/eight assertions, 115 connections, 279 obstacles, 205 routed traces and 1143
actual worker dispatches. Complete routed-SRJ hashes matched exactly:
`f1404b10babf382867a0eb85cf5a8a3851130465cba7af4314c9f109d7a6561a`.
The existing test also passed exact HD routes/stats/work, total pipeline work,
input preservation and its final SVG assertion. This is functional evidence,
not a timing comparison.

The final legacy-compatible source passed 32 focused tests with 790 assertions
(26 tests/581 assertions and six relevant regressions/209 assertions). They include
immutable/accessor method eligibility, exact legacy/eager/lazy parity at 0.15 and
0.2 mm, an A03 winner through final width conversion, rare seed5 scheduling,
charged PriorityDAG constructor work and cold native-worker parity. Centralized
compile/build checks remain separate required validation; no earlier race speedup
is inferred from these tests.

The superseded corrected-policy source and its adverse evidence are retained:
lazy source `fbf95287d98e067e314eae1c47999664f3305fb6` passed A64, T113 and
P4 circuit102 numerical checks, but the USB-shield check was censored at its
external 180-second limit. The corresponding eager source
`2708fcb418808ce519f2ec56087992b901152f30` passed all nine USB numerical assertions
in a separate phase-observed diagnostic with a 360-second external limit
(183.26 seconds elapsed; peak child RSS 4,375,355,392 bytes). This is functional
diagnostic evidence, not a paired timing result or proof that lazy setup caused
the earlier censor. The original 180-second result remains censored. These sources
excluded A03 at requested widths 0.15/0.2 mm; the final deterministic modes restore
the legacy proposal pool and require fresh validation.

```sh
bun test tests/solvers/lazy-portfolio-*.test.ts \
  tests/solvers/portfolio-mode-*.test.ts \
  tests/features/lazy-portfolio-native-worker-parity.test.ts --timeout 9999999
```

TypeScript/build and full dataset validation are coordinated separately.
No local full-board benchmark is included in these focused checks.

## Paired measurement plan

The coordinator compares baseline637, the archived c7f2715 CPU racer, legacy-compatible
`eager`, and new `lazy` on all 16 dataset18 and 26 dataset24 boards. Exact refs,
resolved dependencies, captured upstream HD inputs and terminal outcomes remain
separate per arm. An eager control is derived from this source by one
factory literal change only:

```
createPipeline9RegularNodeSolver:
  portfolioMode: "lazy"  ->  portfolioMode: "eager"
```

This option is internal to the regular-node factory; it is not added to the
captured Pipeline9HighDensitySolver input object. No worker environment override
or alternate worker implementation is needed. Historical timing results are not
pooled into the new ablation. Compare final clean completion, unchanged eager/lazy
outputs and work, initial-HD time, downstream repair, memory and setup counts.
Results and any remaining parity/quality failures must be recorded before a speed
or promotion claim.
