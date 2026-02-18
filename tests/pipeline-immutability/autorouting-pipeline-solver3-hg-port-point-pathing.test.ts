import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver3_HgPortPointPathing } from "lib/autorouter-pipelines/AutoroutingPipeline2_PortPointPathing/AutoroutingPipelineSolver3_HgPortPointPathing"
import { getFreshE2e3 } from "../fixtures/getFreshE2e3"

test(
  "AutoroutingPipelineSolver3_HgPortPointPathing solves and does not mutate input SRJ",
  () => {
    const srj = getFreshE2e3()
    const before = structuredClone(srj)

    const solver = new AutoroutingPipelineSolver3_HgPortPointPathing(srj)
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(srj).toEqual(before)
  },
  { timeout: 180_000 },
)
