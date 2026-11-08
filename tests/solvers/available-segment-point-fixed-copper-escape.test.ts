import { expect, test } from "bun:test"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { createFixedTracePortAvailability } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "lib/types"

test("fixed copper cannot make a necessary numerical terminal escape look redundant", (): void => {
  const nodes: CapacityMeshNode[] = [
    ["source", 0, 0, 1],
    ["west", -1, 0, 1],
    ["southwest", -1, -1, 1],
    ["south", 0.500127, -1, 2.000254],
    ["southeast", 2.000254, -1, 1],
    ["escape", 1.000254, 0, 1],
    ["destination", 2.000254, 0, 1],
  ].map(([id, x, y, width]) => ({
    capacityMeshNodeId: String(id),
    center: { x: Number(x), y: Number(y) },
    width: Number(width),
    height: 1,
    layer: "z0",
    availableZ: [0],
    _containsObstacle: id === "source" || id === "destination",
    _containsTarget: id === "source" || id === "destination",
    _connectedTo: id === "source" || id === "destination" ? ["GND"] : undefined,
  }))
  const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
  edges.solve()
  for (const [isFixed, sameNet, layer] of [
    [true, false, "top"],
    [false, false, "top"],
    [true, true, "top"],
    [true, false, "bottom"],
  ] as const) {
    const input: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minTraceToPadEdgeClearance: 0.1,
      bounds: { minX: -3, maxX: 3, minY: -2, maxY: 1 },
      obstacles: [],
      connections: [
        {
          name: "GND",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 2.000254, y: 0, layer: "top" },
          ],
        },
      ],
      traces: [
        {
          type: "pcb_trace",
          pcb_trace_id: "retained",
          connection_name: sameNet ? "GND" : "POWER",
          isFixed,
          route: [
            { route_type: "wire", x: -0.5, y: 0.6, width: 0.1, layer },
            { route_type: "wire", x: -0.5, y: -0.5, width: 0.1, layer },
            { route_type: "wire", x: 0.5, y: -0.5, width: 0.1, layer },
          ],
        },
      ],
    }
    const original = structuredClone(input)
    const solver = new AvailableSegmentPointSolver({
      nodes,
      edges: edges.edges,
      traceWidth: 0.1,
      shouldReturnCrampedPortPoints: true,
      connections: input.connections,
      isOrdinaryPortAvailable: createFixedTracePortAvailability(input),
    })
    solver.solve()
    const bridge = solver
      .getOutput()
      .find(
        (segment) =>
          segment.nodeIds.includes("source") &&
          segment.nodeIds.includes("escape"),
      )
    expect(Boolean(bridge?.isActiveTerminalEscape)).toBe(
      isFixed && !sameNet && layer === "top",
    )
    expect(input).toEqual(original)
  }
})
