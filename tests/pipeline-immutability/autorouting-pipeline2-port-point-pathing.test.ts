import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver2_PortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver2_PortPointPathing"
import type { SimpleRouteJson } from "lib/types"
import e2e3Fixture from "../../fixtures/legacy/assets/e2e3.json"

test(
  "AutoroutingPipelineSolver2_PortPointPathing solves and does not mutate input SRJ",
  () => {
    const srj = e2e3Fixture as SimpleRouteJson
    const before = structuredClone(srj)

    const solver = new AutoroutingPipelineSolver2_PortPointPathing(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(srj).toEqual(before)
  },
  { timeout: 180_000 },
)
