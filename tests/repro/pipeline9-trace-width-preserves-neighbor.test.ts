import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("width improvement keeps another connection's hypergraph assignment", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -15, maxX: 15, minY: -10, maxY: 10 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.13,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -11.4, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 11.4, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 1.425 },
        width: 20,
        height: 2.35,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -1.425 },
        width: 20,
        height: 2.35,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "WIDE_POWER",
        nominalTraceWidth: 0.4,
        pointsToConnect: [
          { x: -11.4, y: 0, layer: "top" },
          { x: 11.4, y: 0, layer: "top" },
        ],
      },
      {
        name: "OTHER",
        pointsToConnect: [
          { x: -11, y: -5, layer: "top" },
          { x: 11, y: -5, layer: "top" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(
    solver.hypergraphTraceWidthImprovementSolver?.stats.rejectedCrossingCount,
  ).toBe(1)
  const before = solver.portPointPathingSolver!.getOutput().nodesWithPortPoints
  const after =
    solver.hypergraphTraceWidthImprovementSolver!.getOutput()
      .nodesWithPortPoints
  const otherPorts = (nodes: typeof before): string[] =>
    nodes
      .flatMap((node) =>
        node.portPoints
          .filter((point) => point.connectionName === "OTHER")
          .map((point) => `${node.capacityMeshNodeId}:${point.portPointId}`),
      )
      .sort()
  expect(otherPorts(before).length).toBeGreaterThan(0)
  expect(otherPorts(after)).toEqual(otherPorts(before))
  expect(solver.getOutputSimplifiedPcbTraces().length).toBe(2)
})
