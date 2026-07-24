import { expect, test } from "bun:test"
import { createStitchSegmentRouter } from "lib/solvers/RouteStitchingSolver/create-stitch-segment-validator"

test("stitch pathfinder routes around foreign copper with validated segments", () => {
  const router = createStitchSegmentRouter({
    hdRoutes: [],
    obstacles: [
      {
        type: "rect",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["foreign"],
      },
    ],
    layerCount: 2,
    minClearance: 0.1,
  })
  const request = {
    connectionName: "candidate",
    start: { x: -1, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
    traceThickness: 0.15,
  }

  expect(router.isValidSegment(request)).toBe(false)
  const path = router.findValidPath(request)
  expect(path?.length).toBeGreaterThan(2)
  expect(path?.[0]).toEqual(request.start)
  expect(path?.[path!.length - 1]).toEqual(request.end)
  for (let index = 0; index < path!.length - 1; index += 1) {
    expect(
      router.isValidSegment({
        ...request,
        start: path![index]!,
        end: path![index + 1]!,
      }),
    ).toBe(true)
  }
})
