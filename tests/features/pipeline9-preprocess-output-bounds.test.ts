import { expect, test } from "bun:test"
import { PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectionPointOutsideBoundsError } from "lib/utils/getConnectionPointOutsideBoundsError"

test("pipeline 9 rejects a terminal outside bounds recomputed from the outline", (): void => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
    outline: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    obstacles: [
      {
        type: "rect",
        obstacleId: "outside",
        center: { x: 8, y: 8 },
        width: 1,
        height: 1,
        layers: ["top"],
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: 5, y: 0, layer: "top" },
          { x: 0, y: 0, layer: "top" },
        ],
      },
    ],
    traces: [],
  }
  const solver = new PreprocessSimpleRouteJsonWithoutTraceObstaclesSolver(input)
  expect(getConnectionPointOutsideBoundsError(input)).toBeNull()
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain('Connection "net"')
  expect(solver.error).toContain("x [-1, 1], y [-1, 1]")
  expect(solver.outputSrj).toBeUndefined()
  expect(() => solver.getOutputSimpleRouteJson()).toThrow("has not solved yet")
})
