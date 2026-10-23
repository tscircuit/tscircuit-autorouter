import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "lib/types"

test("default Pipeline9 exercises the electrical-tree solver and emits connected valid copper", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -4, maxX: 34, minY: -4, maxY: 30 },
    obstacles: [{
      type: "rect",
      center: { x: 10, y: 10 },
      width: 2,
      height: 2,
      layers: ["top", "bottom"],
      connectedTo: [],
    }],
    connections: [{
      name: "bus",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
        { x: 30, y: 0, layer: "top", pcb_port_id: "end" },
        { x: 19, y: 25, layer: "top", pcb_port_id: "branch" },
      ],
    }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
  solver.solve()
  expect(solver.solved).toBe(true)
  const pairs = solver.srjWithPointPairs!.connections
  expect(pairs).toHaveLength(2)
  expect(pairs.flatMap((pair) => pair.pointsToConnect)
    .filter((point) => point.pcb_port_id === "end")).toHaveLength(2)
  const metrics = solver.portPointPathingSolver!.getSolveGraphBenchmarkMetrics()!
  expect(metrics.electricalTreeTargetCount).toBeGreaterThan(0)
  expect(metrics.electricalTreeSuffixSegmentCount).toBeGreaterThan(0)
  expect(metrics.electricalTreeSearchStepCount).toBeGreaterThan(0)
  expect(metrics.electricalTreeAliasConnectorCount).toBeGreaterThan(0)
  const terminals = solver.highDensityRouteSolver!.routes.flatMap((route) => route.route)
  const assignedPoints = solver.portPointPathingSolver!.getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
  for (const pair of pairs) {
    const endpoint = pair.pointsToConnect.findIndex((point) => point.pcb_port_id === "end")
    const terminalId = `tiny-terminal:${endpoint === 0 ? "start" : "end"}-port:${pair.name}`
    expect(assignedPoints.some((point) =>
      point.connectionName === pair.name && point.portPointId === terminalId &&
      point.pcb_port_id === "end" && point.x === 30 && point.y === 0 && point.z === 0,
    )).toBe(true)
    expect(terminals.some((point) =>
      point.pcb_port_id === "end" && point.x === 30 && point.y === 0 && point.z === 0,
    )).toBe(true)
  }
  const output = solver.getOutputSimplifiedPcbTraces()
  expect(output.length).toBeGreaterThan(0)
  expect(evaluateRelaxedDrc({
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: output,
  }).errors).toHaveLength(0)
})
