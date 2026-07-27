import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 preserves the srj23 sample 32 capacity topology", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 32)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, {
    cacheProvider: null,
    effort: 1,
  })

  while (!solver.failed && !solver.portPointPathingSolver?.solved) {
    solver.step()
  }

  expect(solver.failed).toBe(false)
  expect(solver.portPointPathingSolver?.solved).toBe(true)
  expect(solver.preloadedTraceGraphSolver?.stats).toMatchObject({
    topologyChanged: false,
    inputBoundaryCount:
      solver.preloadedTraceGraphSolver?.stats.outputBoundaryCount,
    inputPortCount: solver.preloadedTraceGraphSolver?.stats.outputPortCount,
  })
  expect(
    solver.capacityNodes?.some((node) =>
      node.capacityMeshNodeId.includes("__preloaded_"),
    ),
  ).toBe(false)
  expect(solver.capacityNodes).toEqual(
    solver.nodeDimensionSubdivisionSolver?.outputNodes ?? null,
  )
})
