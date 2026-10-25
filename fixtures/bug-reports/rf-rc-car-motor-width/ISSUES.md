# P1: RF RC car motor routes narrow below the specified 1 mm

The receiver PCB visibly narrows both left-motor tracks between U2 (L293D) and
JML. The matching right-motor tracks stay broad. This report was discovered from
the routed PCB and its design specification; it concerns copper width, not
clearance. Motor current passes through the narrowed sections.

## Full-board reproduction

[`rf-rc-car-motor-width.srj.json`](rf-rc-car-motor-width.srj.json) is the unchanged
phase-0 router input captured from the original receiver design: a 74 × 52 mm,
two-layer board with all 15 connections and 63 obstacles. Nothing was cropped or
removed. [`receiver.source.tsx.txt`](receiver.source.tsx.txt) preserves the original
design specification; the SRJ test and debugger do not compile or depend on it.

Run `bun test tests/bugs/rf-rc-car-motor-width.test.ts --timeout 9999999`, or open
the adjacent Cosmos fixture. Both use Pipeline 9 with `cacheProvider: null`.
The [full-board snapshot](../../../tests/bugs/__snapshots__/rf-rc-car-motor-width.snap.svg)
shows newly routed copper and the benchmark relaxed-DRC count; it does not claim
a clean or fabrication-ready board.

Latest uncached replay succeeds but emits:

| Connection | Motor path | Nominal width | Minimum output width | Sustained length below 1 mm |
| --- | --- | ---: | ---: | ---: |
| `source_trace_42` | U2.OUT_L1 → JML.1 | 1 mm | **0.15 mm** | **12.649 mm** |
| `source_trace_43` | U2.OUT_L2 → JML.2 | 1 mm | **0.30 mm** | **11.382 mm** |
| `source_trace_44` | U2.OUT_R1 → JMR.1 | 1 mm | 1 mm | 0 mm |
| `source_trace_45` | U2.OUT_R2 → JMR.2 | 1 mm | 1 mm | 0 mm |

Lengths count only adjacent same-layer wire points with both widths below 1 mm.
The 0.15 mm section has 6.67 times the resistance per unit length of equal copper
thickness at 1 mm. Hardware has not been tested.

## Width-contract caveat

The original TSX requests `thickness="1mm"` on all four motor traces, and the
source Circuit JSON records `min_trace_thickness: 1`. However, this captured SRJ
expresses each motor width as `nominalTraceWidth: 1` and `width: 1`, while the
board-wide `minTraceWidth` remains 0.15 mm. It has no per-connection hard minimum.
Consequently this unmodified fixture demonstrates failure to preserve the
design's requested width, not proof that an SRJ hard-minimum constraint was
violated. The fix must respect that distinction rather than redefining every
nominal width as an unconditional minimum.

## Expected routing improvement

Honor the motor-width requirement through the routing input contract and emitted
copper, or report that a compliant route cannot be produced. A fix should change
the routed geometry, retain both right-motor controls, preserve connectivity, and
avoid introducing copper errors. Widening saved output in place is insufficient.
The reproduction test deliberately asserts the current narrowing; a stacked fix
should replace those checks with its corrected routing expectations and update
the full-board snapshot.
