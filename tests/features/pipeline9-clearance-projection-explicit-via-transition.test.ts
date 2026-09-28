import { expect, test } from "bun:test"
import { applyPipeline9ClearanceProjection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearanceProjection"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("clearance projection materializes an explicit via before checking fixed copper", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0 },
    { x: -1, y: 0.28, z: 0 },
    { x: 1, y: 0.28, z: 0 },
    { x: 4, y: 0, z: 0 },
  ]
  fixture.routes.push({
    connectionName: "explicit-via-route",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -3, y: 2, z: 0 },
      { x: -2, y: 2, z: 1 },
      { x: 2, y: 2, z: 1 },
    ],
    vias: [{ x: -3, y: 2 }],
  })
  const original = structuredClone(fixture.routes)
  const result = applyPipeline9ClearanceProjection(fixture)
  expect(fixture.routes).toEqual(original)
  expect(result[1]!.route).toEqual([
    { x: -3, y: 2, z: 0 },
    { x: -3, y: 2, z: 1 },
    { x: -2, y: 2, z: 1 },
    { x: 2, y: 2, z: 1 },
  ])
  expect(result[1]!.vias).toEqual(original[1]!.vias)
  const validation = fixture.drcEvaluator({ traces: [], routes: result })
  expect(Array.isArray(validation) ? validation : validation.errors).toEqual([])
})
