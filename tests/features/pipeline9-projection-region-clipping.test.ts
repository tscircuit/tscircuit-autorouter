import { expect, test } from "bun:test"
import { createPipeline9ProjectionRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9ProjectionRegions"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("projection windows lock cut points and map only their original source routes", (): void => {
  const fixture = createBoundedRegionalRepairFixture(40)
  fixture.originalSrj.bounds.minX = -24
  fixture.originalSrj.bounds.maxX = 24
  const assignments = new Map<string, number>()
  for (const [index, route] of fixture.routes.entries()) {
    route.route[0]!.x = -20
    route.route[2]!.x = 20
    const point = route.route[1]!
    assignments.set(`${point.x},${point.y}`, Math.floor(index / 10))
  }
  const srj = { ...createSrjWithBoardValidObstacleLayers(fixture.originalSrj), traces: undefined }
  const input = {
    srj,
    routes: fixture.routes,
    bounds: srj.bounds,
    boundaryMargin: 0,
    lockedPointIndices: fixture.routes.map((route) => route.route.map(() => false)),
  }
  const regions = createPipeline9ProjectionRegions(input, assignments)
  expect(regions).toHaveLength(4)
  let cutPoints = 0
  let movablePoints = 0
  for (const [partition, region] of regions.entries()) {
    expect(region.input.routes.length).toBeLessThan(fixture.routes.length)
    for (const [localIndex, route] of region.input.routes.entries()) {
      const source = fixture.routes[region.sourceRouteIndexes[localIndex]!]!
      const sourceKeys = new Set(source.route.map((point) => `${point.x},${point.y},${point.z}`))
      for (const [pointIndex, point] of route.route.entries()) {
        const locked = region.input.lockedPointIndices[localIndex]![pointIndex]!
        if (!sourceKeys.has(`${point.x},${point.y},${point.z}`)) {
          cutPoints++
          expect(locked).toBe(true)
        }
        if (!locked) {
          movablePoints++
          expect(assignments.get(`${point.x},${point.y}`)).toBe(partition)
        }
      }
    }
  }
  expect(cutPoints).toBeGreaterThan(0)
  expect(movablePoints).toBeGreaterThan(0)
})
