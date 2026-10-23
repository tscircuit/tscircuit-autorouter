import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("a shared tree crossing a third PCB pad preserves physical pad identity and every original demand through the full pipeline", async (): Promise<void> => {
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
  const physical = solver.portPointPathingSolver!.getRoutingOutput()
  const points = physical.nodesWithPortPoints
    .flatMap((node) => node.portPoints)
  const thirdPad = scenario.connections.flatMap((connection) => connection.pointsToConnect)
    .find((point) => point.pcb_port_id === "pcb_port_19")!
  const junctions = points.filter((point) =>
    point.x === thirdPad.x && point.y === thirdPad.y)
  expect(junctions.length).toBeGreaterThan(0)
  expect(junctions.every((point) => point.electricalTerminalId === "pcb_port_19" && point.pcb_port_id === "pcb_port_19")).toBe(true)
  const adjacency = new Map<string, Set<string>>()
  for (const branch of physical.connections) {
    if (!solver.connMap.areIdsConnected(branch.name, pairName)) continue
    const [a, b] = branch.pointsToConnect
    const left = a!.pcb_port_id ?? a!.pointId!, right = b!.pcb_port_id ?? b!.pointId!
    if (!adjacency.has(left)) adjacency.set(left, new Set())
    if (!adjacency.has(right)) adjacency.set(right, new Set())
    adjacency.get(left)!.add(right)
    adjacency.get(right)!.add(left)
  }
  const reached = new Set<string>()
  const pending = ["pcb_port_19"]
  while (pending.length > 0) {
    const vertex = pending.pop()!
    if (reached.has(vertex)) continue
    reached.add(vertex)
    pending.push(...(adjacency.get(vertex) ?? []))
  }
  for (const endpoint of pair.pointsToConnect) {
    expect(reached.has(endpoint.pcb_port_id!)).toBe(true)
    expect(points.some((point) => solver.connMap.areIdsConnected(point.connectionName, pairName) &&
      point.pcb_port_id === endpoint.pcb_port_id &&
      point.x === endpoint.x && point.y === endpoint.y)).toBe(true)
  }
  const metrics = solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!
  expect(metrics.electricalTreeTargetCount).toBeGreaterThan(0)
  expect(metrics.electricalTreeSuffixSegmentCount).toBeGreaterThan(0)
  expect(solver.portPointPathingSolver!.stats.electricalTreeVerifiedDemandCount).toBe(solver.srjWithPointPairs!.connections.length)
  expect(evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }).errors).toHaveLength(0)
})
