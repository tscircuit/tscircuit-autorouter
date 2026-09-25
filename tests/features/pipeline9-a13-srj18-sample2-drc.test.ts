import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 completes SRJ18 sample 2 without A13 repair regressions", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 2)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.portPointPathingSolver!.solved).toBe(true)
  const pathedConnections = new Set(
    solver.portPointPathingSolver!
      .getOutput()
      .nodesWithPortPoints.flatMap((node) =>
        (node.portPointsInPairs ?? []).map(([start]) => start.connectionName),
      ),
  )
  expect(pathedConnections).toEqual(
    new Set(
      solver.srjWithPointPairs!.connections.map((connection) => connection.name),
    ),
  )
  expect(
    evaluateRelaxedDrc({
      inputSrj: scenario,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }).errors,
  ).toEqual([])
})
