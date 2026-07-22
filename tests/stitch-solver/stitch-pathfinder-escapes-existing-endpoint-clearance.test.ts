import { expect, test } from "bun:test"
import { createStitchSegmentRouter } from "lib/solvers/RouteStitchingSolver/createStitchSegmentValidator"

test("stitch pathfinder can escape an existing endpoint clearance violation", () => {
  const router = createStitchSegmentRouter({
    hdRoutes: [],
    layerCount: 2,
    minClearance: 0.15,
    obstacles: [
      {
        type: "rect",
        center: { x: -5.5, y: 2.335 },
        width: 0.59,
        height: 0.64,
        layers: ["top"],
        connectedTo: ["foreign"],
      },
    ],
  })
  const request = {
    connectionName: "conn",
    start: { x: -5.205, y: 2.855, z: 0 },
    end: { x: -4.285, y: 2.735, z: 0 },
    traceThickness: 0.1,
  }

  expect(router.isValidSegment(request)).toBe(false)
  const path = router.findValidPath(request)
  expect(path).toBeDefined()
  expect(path!.length).toBeGreaterThan(2)
  expect(path![0]).toEqual(request.start)
  expect(path!.at(-1)).toEqual(request.end)
})
