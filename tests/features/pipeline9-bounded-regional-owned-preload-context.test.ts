import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import type { SimpleRouteConnection, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("owned regional repair routes around immutable preload copper", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  const fixedPreloadedTraces: SimplifiedPcbTrace[] = [-0.45, 0.45].map(
    (y, index): SimplifiedPcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: `fixed_${index}`,
      connection_name: `foreign_${index}`,
      route: [
        { route_type: "wire", x: -3, y, width: 0.2, layer: "top" },
        { route_type: "wire", x: 3, y, width: 0.2, layer: "top" },
      ],
    }),
  )
  const fixedObstacleRoutes: HighDensityRoute[] = [-0.45, 0.45].map(
    (y, index): HighDensityRoute => ({
      connectionName: `foreign_${index}`,
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [{ x: -3, y, z: 0 }, { x: 3, y, z: 0 }],
      vias: [],
    }),
  )
  fixture.originalSrj.connections.push(
    ...[-0.45, 0.45].map((y, index): SimpleRouteConnection => ({
      name: `foreign_${index}`,
      pointsToConnect: [
        { x: -3, y, layer: "top", pcb_port_id: `foreign_${index}_start` },
        { x: 3, y, layer: "top", pcb_port_id: `foreign_${index}_end` },
      ],
    })),
  )
  fixture.originalSrj.traces = fixedPreloadedTraces
  const original = structuredClone(fixture.originalSrj)
  const originalFixedRoutes = structuredClone(fixedObstacleRoutes)
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    syntheticConnectionNames: new Set(["signal"]),
    fixedPreloadedContext: {
      traces: fixedPreloadedTraces,
      obstacleRoutes: fixedObstacleRoutes,
    },
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  const validation = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(
    Array.isArray(validation) ? validation : validation.errors,
  ).toHaveLength(0)
  expect(result.referenceValidationCount).toBeGreaterThan(0)
  expect(result.publishedDrcIssueCount).toBe(0)
  expect(result.repaired).toBeTrue()
  expect(result.candidateAttemptCount).toBeLessThanOrEqual(1024)
  expect(result.pathSearchNodeCount).toBeLessThanOrEqual(480_000)
  expect(fixture.originalSrj).toEqual(original)
  expect(fixedObstacleRoutes).toEqual(originalFixedRoutes)
})
