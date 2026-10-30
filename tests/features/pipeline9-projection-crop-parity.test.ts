import { expect, test } from "bun:test"
import { RelaxTraceClearanceSolver } from "@tscircuit/repair04"
import { cropPipeline9ProjectionInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/cropPipeline9ProjectionInput"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("cropped projection retains collision and remote same-net junction context", (): void => {
  const fixture = createBoundedRegionalRepairFixture(30)
  fixture.routes[0]!.rootConnectionName = "shared_net"
  fixture.routes[29]!.rootConnectionName = "shared_net"
  const routes = fixture.routes
  const srj = { ...createSrjWithBoardValidObstacleLayers(fixture.originalSrj), traces: undefined }
  const input = {
    srj,
    routes,
    bounds: srj.bounds,
    boundaryMargin: 0,
    lockedPointIndices: routes.map((route) => route.route.map(() => false)),
    allowViaMovement: true,
    traceClearance: 0.1,
    viaClearance: 0.1,
  }
  const assignments = new Map<string, number>()
  for (const [index, route] of routes.entries()) {
    for (const point of route.route) assignments.set(`${point.x},${point.y}`, Math.floor(index / 8))
  }
  const crop = cropPipeline9ProjectionInput(input, assignments, 0)
  expect(crop.routeIndexes).toContain(0)
  expect(crop.routeIndexes).toContain(29)
  expect(crop.routeIndexes.length).toBeLessThan(routes.length)
  const fullInput = {
    ...input,
    lockedPointIndices: routes.map((route) =>
      route.route.map((point) => assignments.get(`${point.x},${point.y}`) !== 0),
    ),
  }
  const full = new RelaxTraceClearanceSolver(fullInput)
  const cropped = new RelaxTraceClearanceSolver(crop.input)
  full.solve()
  cropped.solve()
  expect(full.failed).toBe(false)
  expect(cropped.failed).toBe(false)
  const fullRoutes = full.getOutput()
  const croppedRoutes = cropped.getOutput()
  expect(fullRoutes.some((route, index) => JSON.stringify(route.route) !== JSON.stringify(routes[index]!.route))).toBe(true)
  for (const [localIndex, originalIndex] of crop.routeIndexes.entries()) {
    const source = routes[originalIndex]!
    for (const [pointIndex, point] of source.route.entries()) {
      if (assignments.get(`${point.x},${point.y}`) === 0) {
        expect(croppedRoutes[localIndex]!.route[pointIndex]).toEqual(fullRoutes[originalIndex]!.route[pointIndex])
      }
    }
  }
})
