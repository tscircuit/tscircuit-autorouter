import { expect, test } from "bun:test"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import type { SimpleRouteJson } from "lib/types"

test("a two-layer via retains its terminal access after pad-layer separation", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    bounds: { minX: -1, maxX: 3, minY: -1, maxY: 1 },
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pcb_port_id: "pad" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "other" },
        ],
      },
    ],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.45,
        height: 0.45,
        layers: ["bottom"],
        connectedTo: ["pad", "signal"],
        circuitJsonMetadata: { pcb_via_id: "existing-via" },
      },
    ],
  }
  const original = structuredClone(input)
  const solver = new PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver(input)
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(
    solver.getOutputSimpleRouteJson().connections[0]!.pointsToConnect[0],
  ).toEqual({ x: 0, y: 0, layers: ["top", "bottom"], pcb_port_id: "pad" })
  expect(
    solver.getOutputSimpleRouteJson().connections[0]!.pointsToConnect[1],
  ).toEqual(original.connections[0]!.pointsToConnect[1])
  expect(input).toEqual(original)
})
