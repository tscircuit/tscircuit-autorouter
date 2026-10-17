import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver6 } from "lib/autorouter-pipelines/AutoroutingPipeline6_PolyHypergraph/AutoroutingPipelineSolver6_PolyHypergraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"
import srj from "../../fixtures/features/octagonal-regions.json"

test("octagonal pipeline completes crossing connections around an obstacle with zero relaxed DRC errors", () => {
  const input = srj as SimpleRouteJson
  const solver = new AutoroutingPipelineSolver6(input, {
    polyRegionShape: "octagonal", effort: 0.2,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const traces = solver.getOutputSimplifiedPcbTraces()
  expect(traces).toHaveLength(2)
  const drc = evaluateRelaxedDrc({ inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces })
  expect(drc.errors).toEqual([])
  for (const connection of input.connections) {
    const trace = traces.find((candidate) => candidate.connection_name === connection.name)!
    for (const [i, point] of connection.pointsToConnect.entries()) {
      const segment = trace.route[i === 0 ? 0 : trace.route.length - 1]!
      expect(segment).toMatchObject({ x: point.x, y: point.y, layer: point.layer })
    }
  }
})
