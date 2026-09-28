import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 keeps repaired SRJ23 sample 25 PCB port metadata on route endpoints", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 25)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const hdRoutes = solver._getOutputHdRoutes()
  expect(hdRoutes.length).toBeGreaterThan(0)
  for (const hdRoute of hdRoutes) {
    for (const interiorPoint of hdRoute.route.slice(1, -1)) {
      expect(interiorPoint.pcb_port_id).toBeUndefined()
    }
  }
})
