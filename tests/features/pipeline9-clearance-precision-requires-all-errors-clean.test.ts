import { expect, test } from "bun:test"
import { applyPipeline9ClearancePrecisionRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearancePrecisionRepairs"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("clearance precision preserves original routes until full reference DRC passes", (): void => {
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      { name: "via_owner", pointsToConnect: [] },
      { name: "signal", pointsToConnect: [] },
    ],
  }
  const routes: HighDensityRoute[] = [
    {
      connectionName: "via_owner",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -1, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 1, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "signal",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [-1, -0.5, 0.5, 1].map((x) => ({ x, y: 0.289, z: 0 })),
      vias: [],
    },
  ]
  const originalRoutes = structuredClone(routes)
  let evaluationCount = 0
  let indexedEvaluationCount = 0
  const result = applyPipeline9ClearancePrecisionRepairs({
    srj,
    routes,
    newConnections: srj.connections,
    syntheticConnectionNames: new Set(),
    connMap: getConnectivityMapFromSimpleRouteJson(srj),
    initialErrors: [
      {
        type: "pcb_via_trace_clearance_error",
        pcb_trace_id: "signal_0",
        pcb_trace_ids: ["signal_0", "via_owner_0"],
        pcb_via_id: "via_0",
        pcb_via_ids: ["via_0"],
        actual_clearance: 0.089,
        minimum_clearance: 0.1,
        center: { x: 0, y: 0 },
      },
    ],
    indexedDrcEvaluator: () => {
      indexedEvaluationCount++
      return [
        {
          type: "pcb_trace_error",
          minimum_clearance: 1,
          actual_clearance: indexedEvaluationCount === 1 ? 0 : 1,
        },
      ]
    },
    candidateDrcEvaluator: () => ({ errors: [], errorsWithCenters: [] }),
    marginDrcEvaluator: () => [],
    drcEvaluator: () => {
      evaluationCount++
      return {
        errors: [{ type: "pcb_trace_error", message: "Missing connection" }],
        errorsWithCenters: [],
      }
    },
  })
  expect(evaluationCount).toBeGreaterThan(0)
  expect(result.repaired).toBeFalse()
  expect(result.routes).toBe(routes)
  expect(routes).toEqual(originalRoutes)
  expect(result.attemptedCandidateCount).toBe(indexedEvaluationCount)
  expect(result.candidateValidationCount).toBe(1)
  expect(result.referenceValidationCount).toBe(evaluationCount)
  expect(result.referenceValidationCount).toBe(1)
  expect(result.attemptedCandidateCount).toBeLessThanOrEqual(24)
})
