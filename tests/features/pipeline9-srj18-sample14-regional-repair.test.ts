import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("OV9281 finishes regional repair with fixed pad-net ownership", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(
    solver.pipeline9JointDrcRepairSolver!.stats
      .initialBoundedRegionalRepairAccepted,
  ).toBeTrue()
  expect(
    solver.pipeline9JointDrcRepairSolver!.exactRepairSolver,
  ).toBeUndefined()

  const traces = solver.getOutputSimplifiedPcbTraces()
  const pointPairs = solver.srjWithPointPairs!
  expect(traces).toHaveLength(pointPairs.connections.length)
  expect(traces.map((trace) => [...trace.connectsTo!].sort()).sort()).toEqual(
    pointPairs.connections
      .map((connection) =>
        connection.pointsToConnect.map((point) => point.pcb_port_id!).sort(),
      )
      .sort(),
  )
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: pointPairs,
    routedTraces: traces,
  })
  expect(errors, JSON.stringify(errors, null, 2)).toHaveLength(0)
})
