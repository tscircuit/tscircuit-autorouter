import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance projection preserves endpoints while making near-colocated vias exact", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes.push({
    connectionName: "near-colocated-via",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -3, y: 2, z: 0 },
      { x: -3 + 1e-9, y: 2, z: 1 },
      { x: 2, y: 2, z: 1 },
    ],
    vias: [{ x: -3 + 1e-9, y: 2 }],
  })
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9ClearanceProjection(fixture)
  expect(fixture.routes).toEqual(original)
  expect(result[1]!.route[0]).toEqual(original[1]!.route[0])
  expect(result[1]!.route.at(-1)).toEqual(original[1]!.route.at(-1))
  expect(result[1]!.route.slice(1, 3)).toEqual([
    { x: -3 + 1e-9, y: 2, z: 0 },
    { x: -3 + 1e-9, y: 2, z: 1 },
  ])
  const validation = fixture.drcEvaluator({ traces: [], routes: result })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
})
