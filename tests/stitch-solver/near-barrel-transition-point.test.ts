import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9TraceSimplificationSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9TraceSimplificationSolver"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import {
  barrelObstacle,
  nearBarrelSegments,
} from "./fixtures/nearBarrelTransition"

test("preserves a barrel site at a nearby stitch join", (): void => {
  const hdRoutes = structuredClone(nearBarrelSegments)
  const original = structuredClone(hdRoutes)
  const clearanceQueries: number[] = []
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: 20, y: -0.965, z: 1 },
    end: { x: 22, y: -0.965, z: 3 },
    hdRoutes,
    isStitchSegmentClear: ({ start, end }): boolean => {
      clearanceQueries.push(Math.hypot(start.x - end.x, start.y - end.y))
      return true
    },
    stitchClearanceMode: "require_clear",
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const stitched = solver.mergedHdRoute
  const transitionIndex = stitched.route.findIndex(
    (point): boolean => point.toNextSegmentType === "through_obstacle",
  )
  expect(stitched.route[transitionIndex]).toMatchObject({
    x: 21.947,
    y: -0.965,
    z: 1,
  })
  expect(stitched.route[transitionIndex + 1]).toMatchObject({
    x: 21.947,
    y: -0.965,
    z: 3,
  })
  expect(stitched.vias).toEqual([{ x: 21.947, y: -0.965 }])
  expect(
    clearanceQueries.some((length): boolean => length > 0 && length < 1e-3),
  ).toBe(true)
  const simplifier = new Pipeline9TraceSimplificationSolver({
    hdRoutes: [stitched],
    obstacles: [barrelObstacle],
    connMap: new ConnectivityMap({ signal: ["signal"] }),
    colorMap: {},
    layerCount: 4,
    defaultViaDiameter: 0.3,
  })
  const marked = simplifier.hdRoutes[0]
  expect(marked.route[transitionIndex].toNextSegmentType).toBe(
    "through_obstacle",
  )
  expect(marked.vias).toHaveLength(0)
  expect(hdRoutes).toEqual(original)
})
