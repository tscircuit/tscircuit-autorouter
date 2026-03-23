import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver4 } from "lib/autorouter-pipelines/AutoroutingPipeline4_TinyHypergraph/AutoroutingPipelineSolver4_TinyHypergraph"
import type { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../../fixtures/legacy/assets/e2e3.json"

test(
  "AutoroutingPipelineSolver4 solves and does not mutate input SRJ",
  () => {
    const srj = e2e3Fixture as SimpleRouteJson
    const before = structuredClone(srj)

    const solver = new AutoroutingPipelineSolver4(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.portPointPathingSolver).toBeDefined()
    expect(typeof solver.portPointPathingSolver?.stats.optimized).toBe(
      "boolean",
    )
    expect(srj).toEqual(before)
  },
  { timeout: 180_000 },
)
