import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 still returns a solved multilayer route when the declared via-pad rule passes", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.45,
    minViaEdgeToPadEdgeClearance: 0.25,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    obstacles: [{
      type: "rect", center: { x: 0, y: 2.5 }, width: 0.2, height: 0.2,
      layers: ["top"], connectedTo: ["other"],
    }],
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: -1, y: 0, layer: "top" },
        { x: 1, y: 0, layer: "bottom" },
      ],
    }],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.viaPadClearanceErrors).toEqual([])
  expect(solver.getOutputSimplifiedPcbTraces().some(
    (trace) => trace.route.some((point) => point.route_type === "via"),
  )).toBe(true)
})
