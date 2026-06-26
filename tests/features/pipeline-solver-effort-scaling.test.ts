import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline2 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline2/AssignableAutoroutingPipeline2"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline3_HgPortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { AutoroutingPipelineSolver4_TinyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import { AutoroutingPipelineSolver6_PolyHypergraph } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver8 } from "lib/autorouter-pipelines/AutoroutingPipeline8/AutoroutingPipelineSolver8"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../../fixtures/legacy/assets/e2e3.json"

// PR #1447 changed these 8 outer pipeline solvers so MAX_ITERATIONS scales
// with effort (this.MAX_ITERATIONS = 100e6 * this.effort). This regression
// test asserts that higher effort yields a higher iteration cap.

// Large effort values, ascending. The cap must strictly increase across them.
const EFFORTS = [50, 100, 500, 10000]

// e2e3 is a small, complete SRJ already proven constructible/solvable by the
// pipeline-immutability tests; construction (which is all we do here) is safe.
const srj = e2e3Fixture as SimpleRouteJson

const SOLVERS: Array<{
  name: string
  construct: (effort: number) => BaseSolver
}> = [
  {
    name: "AutoroutingPipelineSolver2_PortPointPathing",
    construct: (effort) =>
      new AutoroutingPipelineSolver2_PortPointPathing(srj, { effort }),
  },
  {
    name: "AutoroutingPipelineSolver3_HgPortPointPathing",
    construct: (effort) =>
      new AutoroutingPipelineSolver3_HgPortPointPathing(srj, { effort }),
  },
  {
    name: "AutoroutingPipelineSolver4_TinyHypergraph",
    construct: (effort) =>
      new AutoroutingPipelineSolver4_TinyHypergraph(srj, { effort }),
  },
  {
    name: "AutoroutingPipelineSolver6_PolyHypergraph",
    construct: (effort) =>
      new AutoroutingPipelineSolver6_PolyHypergraph(srj, { effort }),
  },
  {
    name: "AutoroutingPipelineSolver7_MultiGraph",
    construct: (effort) =>
      new AutoroutingPipelineSolver7_MultiGraph(srj, { effort }),
  },
  {
    name: "AutoroutingPipelineSolver8",
    construct: (effort) => new AutoroutingPipelineSolver8(srj, { effort }),
  },
  {
    name: "AssignableAutoroutingPipeline2",
    construct: (effort) => new AssignableAutoroutingPipeline2(srj, { effort }),
  },
  {
    name: "AssignableAutoroutingPipeline3",
    construct: (effort) => new AssignableAutoroutingPipeline3(srj, { effort }),
  },
]

for (const { name, construct } of SOLVERS) {
  test(`${name} scales MAX_ITERATIONS with effort`, () => {
    // Construct only (no solve/step) and read the cap set in the constructor.
    const caps = EFFORTS.map((effort) => construct(effort).MAX_ITERATIONS)

    for (const cap of caps) {
      // Even at effort 10000 (100e6 * 10000 = 1e12) the cap stays a safe
      // integer, well under Number.MAX_SAFE_INTEGER (~9.007e15).
      expect(Number.isSafeInteger(cap)).toBe(true)
      expect(cap).toBeGreaterThan(0)
    }

    // Higher effort -> strictly higher iteration cap.
    for (let i = 1; i < caps.length; i++) {
      expect(caps[i]).toBeGreaterThan(caps[i - 1])
    }
  })
}
