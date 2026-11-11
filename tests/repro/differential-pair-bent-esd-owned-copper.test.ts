import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { assertDifferentialPairOutput } from "lib/utils/assertDifferentialPairOutput"
import { getBentDifferentialPairSrj } from "../fixtures/getBentDifferentialPairSrj"

test("bent ESD hops own separate copper outside their common terminal pads", (): void => {
  for (const withTap of [false, true]) {
    const srj = getBentDifferentialPairSrj(withTap)
    const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
      cacheProvider: null,
    })
    solver.solve()
    expect(solver.getResult().status).toBe("solved")
    const traces = solver.getOutputSimplifiedPcbTraces()
    expect(traces).toHaveLength(withTap ? 5 : 4)
    // Validates final copper ownership, exact hop coverage and the 1e-9 skew epsilon.
    expect(() => assertDifferentialPairOutput(srj, traces)).not.toThrow()
    for (const lane of srj.differentialPairs![0]!.connectionNames) {
      expect(solver.connMap.areIdsConnected(lane[0]!, lane[1]!)).toBe(false)
    }
  }
})
