import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib"
import type { SimpleRouteJson } from "lib/types"

test("a one-layer board cannot treat its sole routing plane as advisory", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 1,
    minTraceWidth: 0.15,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pcb_port_id: "a" },
          { x: 2, y: 0, layer: "top", pcb_port_id: "b" },
        ],
      },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solveUntilPhase("highDensityRouteSolver")
  expect(solver.failed, solver.error ?? "").toBeFalse()
  const [params] = solver.portPointPathingSolver!.getConstructorParams()
  expect(params.regionLayerMasksAreBinding).toBeTrue()
})
