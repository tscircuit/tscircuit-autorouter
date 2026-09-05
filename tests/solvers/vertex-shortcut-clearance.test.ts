import { expect, test } from "bun:test"
import {
  segmentToBoxMinDistance,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { VertexShortcutPathSolver } from "lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

test("vertex shortcuts stay clear of pads, thick peers, vias and the board edge", () => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.3,
    viaDiameter: 0.4,
    vias: [],
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 2, z: 0 },
      { x: 2, y: 2, z: 0 },
      { x: 4, y: 2, z: 0 },
      { x: 6, y: 2, z: 0 },
      { x: 8, y: 2, z: 0 },
      { x: 10, y: 2, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
  }
  const obstacle: Obstacle = {
    type: "rect",
    layers: ["top"],
    __zLayers: [0],
    center: { x: 2, y: 0 },
    width: 1,
    height: 1,
    connectedTo: ["pad"],
  }
  const peer: HighDensityRoute = {
    connectionName: "peer",
    traceThickness: 1,
    viaDiameter: 0.8,
    vias: [{ x: 8, y: 0 }],
    route: [
      { x: 5, y: -1, z: 0 },
      { x: 5, y: 0.5, z: 0 },
    ],
  }
  const solver = new VertexShortcutPathSolver({
    inputRoute,
    otherHdRoutes: [peer],
    obstacles: [obstacle],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    useTraceWidthAwareClearance: true,
    outline: [
      { x: -1, y: -2 },
      { x: 11, y: -2 },
      { x: 11, y: 3 },
      { x: -1, y: 3 },
    ],
  })
  solver.solve()
  const output = solver.simplifiedRoute.route
  expect(solver.solved).toBe(true)
  expect(output.length).toBeLessThan(inputRoute.route.length)
  expect(output[0]).toEqual(inputRoute.route[0])
  expect(output.at(-1)).toEqual(inputRoute.route.at(-1))
  for (let index = 1; index < output.length; index++) {
    const a = output[index - 1]
    const b = output[index]
    expect(segmentToBoxMinDistance(a, b, obstacle)).toBeGreaterThanOrEqual(
      0.25 - 1e-9,
    )
    expect(
      minimumDistanceBetweenSegments(a, b, peer.route[0], peer.route[1]),
    ).toBeGreaterThanOrEqual(0.75 - 1e-9)
    expect(pointToSegmentDistance(peer.vias[0], a, b)).toBeGreaterThanOrEqual(
      0.65 - 1e-9,
    )
    expect(b.x).toBeGreaterThanOrEqual(-0.65)
    expect(b.x).toBeLessThanOrEqual(10.65)
    expect(b.y).toBeGreaterThanOrEqual(-1.65)
    expect(b.y).toBeLessThanOrEqual(2.65)
  }
})
