import { expect, test } from "bun:test"
import { planPipeline9ProjectionWindows } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9ProjectionRegions"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("projection windows cover error clusters and exclude distant vertices", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const points = new Map<string, { x: number; y: number; count: number }>()
  for (let i = 0; i < 20; i++) {
    const y = i / 10
    points.set(`0,${y}`, { x: 0, y, count: 1 })
    points.set(`40,${y}`, { x: 40, y, count: 1 })
  }
  points.set("20,0", { x: 20, y: 0, count: 1 })
  const input = {
    srj: { ...fixture.originalSrj, traces: undefined },
    routes: fixture.routes,
    bounds: fixture.originalSrj.bounds,
    boundaryMargin: 0,
    lockedPointIndices: fixture.routes.map((route) => route.route.map(() => false)),
  }
  const result = planPipeline9ProjectionWindows(input, points, [
    { x: 0, y: 1 },
    { x: 40, y: 1 },
  ])
  expect(result.centers).toHaveLength(4)
  expect(result.assignments.size).toBe(40)
  expect(result.assignments.has("20,0")).toBe(false)
  for (const [key, partition] of result.assignments) {
    const point = points.get(key)!
    const center = result.centers[partition]!
    expect(Math.abs(point.x - center.x)).toBeLessThan(4)
    expect(Math.abs(point.y - center.y)).toBeLessThan(4)
  }
  expect(planPipeline9ProjectionWindows(input, points, []).assignments.size).toBe(0)
})
