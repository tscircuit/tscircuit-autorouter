import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("a retained suffix crossing a third PCB pad completes the full default pipeline", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 3)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { effort: 1, cacheProvider: null },
  )
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const pairName = "source_trace_2__source_net_2_mst38"
  const pair = solver.srjWithPointPairs!.connections.find((entry) => entry.name === pairName)!
  expect(pair.pointsToConnect.every((point) => point.pcb_port_id !== "pcb_port_19"))
    .toBe(true)
  const points = solver.portPointPathingSolver!.getOutput().nodesWithPortPoints
    .flatMap((node) => node.portPoints)
  const thirdPad = scenario.connections.flatMap((connection) => connection.pointsToConnect)
    .find((point) => point.pcb_port_id === "pcb_port_19")!
  const junctions = points.filter((point) => point.connectionName === pairName &&
    point.x === thirdPad.x && point.y === thirdPad.y)
  expect(junctions.length).toBeGreaterThan(0)
  expect(junctions.every((point) => point.pcb_port_id === undefined)).toBe(true)
  for (const endpoint of pair.pointsToConnect) {
    expect(points.some((point) => point.connectionName === pairName &&
      point.pcb_port_id === endpoint.pcb_port_id &&
      point.x === endpoint.x && point.y === endpoint.y)).toBe(true)
  }
  const metrics = solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!
  expect(metrics.electricalTreeTargetCount).toBeGreaterThan(0)
  expect(metrics.electricalTreeSuffixSegmentCount).toBeGreaterThan(0)
  expect(evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }).errors).toHaveLength(0)
})
