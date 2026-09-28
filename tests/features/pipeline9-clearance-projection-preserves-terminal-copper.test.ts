import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
} from "@tscircuit/repair04"
import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance projection opens a pad gap without changing terminal copper or route vertices", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0, pcb_port_id: "start" },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0, pcb_port_id: "end" },
  ]
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  expect(Array.isArray(before) ? before : before.errors).toHaveLength(1)
  const routes = applyPipeline9ClearanceProjection(fixture)
  expect(routes).not.toBe(fixture.routes)
  expect(fixture.routes).toEqual(original)
  expect(routes[0]!.route).toHaveLength(original[0]!.route.length)
  expect(routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(routes[0]!.traceThickness).toBe(original[0]!.traceThickness)
  expect(routes[0]!.viaDiameter).toBe(original[0]!.viaDiameter)
  expect(routes[0]!.vias).toEqual(original[0]!.vias)
  const validation = fixture.drcEvaluator({ traces: [], routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
  const srj = { ...fixture.originalSrj, traces: undefined }
  expect(getFixedObstacleViolations({ srj, routes })).toHaveLength(0)
  expect(
    getNewViaPadViolations({ srj, previousRoutes: original, routes }),
  ).toHaveLength(0)
})
