import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/bug-reports/bugreport73-qfp16/bugreport73-qfp16.srj.json"

test("bugreport73 keeps the prerouted QFP pad out of active routing targets", (): void => {
  const solver = new AutoroutingPipelineSolver7_MultiGraph(
    structuredClone(srj) as SimpleRouteJson,
    { cacheProvider: null },
  )
  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const preroutedPadRegions = solver.edgeSolver!.nodes.filter(
    (node) =>
      node._qfpRegionType === "pad" &&
      node._connectedTo?.includes("pcb_smtpad_4"),
  )
  expect(preroutedPadRegions.length).toBeGreaterThan(0)
  expect(preroutedPadRegions.every((node) => !node._containsTarget)).toBeTrue()
})
