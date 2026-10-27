import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { sparseOptions } from "./fixtures"

test("the first sparse route preserves foreign terminal clearance in the captured SRJ18 cell", (): void => {
  const futurePoints = [
    { x: 22.064999999999998, y: -11.3699, z: 1 },
    { x: 22.86, y: -10.635, z: 1 },
  ]
  const solver = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    connectionName: "ancestor",
    bounds: {
      minX: 22.064999999999998,
      maxX: 24.084999999999994,
      minY: -13.632399999999999,
      maxY: -10.635,
    },
    A: { x: 22.064999999999998, y: -10.8225, z: 1 },
    B: { x: 22.86, y: -10.635, z: 0 },
    traceThickness: 0.1,
    obstacleMargin: 0.15,
    viaDiameter: 0.3,
    viaHoleDiameter: 0.15,
    layerCount: 2,
    availableZ: [0, 1],
    connMap: new ConnectivityMap({ ancestor: ["ancestor"], future: ["future"] }),
    futureConnections: [{ connectionName: "future", points: futurePoints }],
  })
  // This accepted predecessor segment leaves only 0.238988mm to the future
  // endpoint, below the actual 0.25mm finite-width requirement.
  expect(
    solver.isSparseEdgeLegal({
      start: { x: 22.064999999999998, y: -10.8225, z: 1 },
      end: { x: 23.784998999999992, y: -10.935001, z: 1 },
    }),
  ).toBe(false)
  solver.solve()
  expect(solver.solved).toBe(true)
  const geometry = getPipeline9RouteCopperGeometry(solver.solvedPath!, {
    layerCount: 2,
  })
  for (const point of futurePoints) {
    for (const wire of geometry.wireSegments) {
      if (wire.z !== point.z) continue
      expect(
        pointToSegmentDistance(point, wire.start, wire.end),
      ).toBeGreaterThanOrEqual(wire.width / 2 + 0.05 + 0.15)
    }
    for (const via of geometry.viaSpans) {
      expect(
        Math.hypot(point.x - via.center.x, point.y - via.center.y),
      ).toBeGreaterThanOrEqual(via.diameter / 2 + 0.05 + 0.15)
    }
  }
})
