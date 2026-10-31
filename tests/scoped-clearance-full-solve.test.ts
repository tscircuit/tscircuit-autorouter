import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { scopedClearanceFixture } from "./fixtures/scoped-clearance"

test("a complete Pipeline9 solve accepts a clear route and rejects a scoped violation", () => {
  for (const separation of [6, 2.2]) {
    const { srj } = scopedClearanceFixture("top")
    for (const point of srj.connections[1]!.pointsToConnect) {
      point.y = separation
    }
    const original = structuredClone(srj)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      effort: 1,
      cacheProvider: null,
    })
    solver.solve()
    expect(srj).toEqual(original)
    expect(solver.solved).toBe(separation === 6)
    expect(solver.failed).toBe(separation === 2.2)
    if (separation === 6) {
      expect(solver.getOutputSimpleRouteJson().clearanceRules).toEqual(
        srj.clearanceRules,
      )
    } else {
      expect(solver.error).toContain("EARTH outer")
    }
  }
})
