import { expect, test } from "bun:test"
import { createStitchSegmentRouter } from "lib/solvers/RouteStitchingSolver/create-stitch-segment-validator"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  points: Array<{ x: number; y: number; z: number }>,
): HighDensityIntraNodeRoute => ({
  connectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
})

test("stitch pathfinder routes around overlapping clearance boundaries", () => {
  const router = createStitchSegmentRouter({
    hdRoutes: [
      makeRoute("foreign_upper", [
        { x: 34.973, y: 0.714, z: 3 },
        { x: 35.073, y: 0.714, z: 3 },
      ]),
      makeRoute("foreign_upper", [
        { x: 34.533, y: 0.964, z: 3 },
        { x: 34.753, y: 0.814, z: 3 },
      ]),
      makeRoute("foreign_lower", [
        { x: 34.753, y: 0.114, z: 3 },
        { x: 34.679, y: 0.314, z: 3 },
        { x: 34.533, y: 0.214, z: 3 },
      ]),
    ],
    obstacles: [
      {
        type: "rect",
        center: { x: 35.0725, y: 0.714 },
        width: 0.2,
        height: 0.2,
        layers: ["bottom"],
        connectedTo: ["foreign_upper"],
      },
    ],
    layerCount: 4,
    minClearance: 0.15,
  })
  const request = {
    connectionName: "candidate",
    start: { x: 34.753, y: 0.439, z: 3 },
    end: { x: 35.0725, y: 0.214, z: 3 },
    traceThickness: 0.1,
  }

  expect(router.isValidSegment(request)).toBe(false)
  const path = router.findValidPath(request)
  expect(path).toBeDefined()
  expect(path!.length).toBeGreaterThan(2)
  expect(path![0]).toEqual(request.start)
  expect(path!.at(-1)).toEqual(request.end)
})
