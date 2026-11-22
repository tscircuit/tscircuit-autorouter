import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { Obstacle, SimpleRouteJson } from "lib/types"

test("keeps an inner signal route when the two surface layers have no path", () => {
  const surfaceLayers = ["top", "bottom"]
  const balls: Obstacle[] = [-2.8, -2, -1.2].flatMap((x) =>
    [-0.8, 0, 0.8].map(
      (y): Obstacle => ({
        componentId: "U1",
        type: "rect",
        shape: "circle",
        center: { x, y },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: x === -1.2 && y === 0 ? ["A", "signal"] : [],
      }),
    ),
  )
  // Two long pads separate the left and right halves of each surface.
  const guards: Obstacle[] = surfaceLayers.map((layer) => ({
    type: "rect",
    center: { x: 0, y: 0 },
    width: 0.3,
    height: 3.7,
    layers: [layer],
    connectedTo: [`guard-${layer}`],
  }))
  const input: SimpleRouteJson = {
    layerCount: 4,
    bounds: { minX: -4, maxX: 4, minY: -2, maxY: 2 },
    minTraceWidth: 0.11,
    minViaPadDiameter: 0.4,
    minViaHoleDiameter: 0.2,
    minTraceToPadEdgeClearance: 0.125,
    minViaEdgeToPadEdgeClearance: 0.125,
    minBoardEdgeClearance: 0.15,
    obstacles: [
      ...balls,
      ...guards,
      {
        componentId: "J1",
        type: "rect",
        center: { x: 2.2, y: 0 },
        width: 0.55,
        height: 0.6,
        layers: ["top"],
        connectedTo: ["B", "signal"],
      },
    ],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -1.2, y: 0, layer: "top", pcb_port_id: "A" },
          { x: 2.2, y: 0, layer: "top", pcb_port_id: "B" },
        ],
      },
    ],
    traces: surfaceLayers.map((layer) => ({
      type: "pcb_trace",
      pcb_trace_id: `guard-${layer}`,
      connection_name: `guard-${layer}`,
      isFixed: true,
      route: [
        { route_type: "wire", x: 0, y: 1.5, width: 0.15, layer },
        { route_type: "wire", x: 0.9, y: 1.5, width: 0.15, layer },
      ],
    })),
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.highDensityRouteSolver?.stats.surfaceRoutingError).toContain(
    "no_path",
  )
  const routes = solver.getOutputSimplifiedPcbTraces()
  expect(routes).toHaveLength(1)
  expect(
    routes[0]!.route.some(
      (point) => point.route_type === "wire" && point.layer.startsWith("inner"),
    ),
  ).toBe(true)
})
