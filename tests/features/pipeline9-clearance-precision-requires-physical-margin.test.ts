import { checkViaTraceClearance } from "@tscircuit/checks"
import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { applyPipeline9ClearancePrecisionRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ClearancePrecisionRepairs"
import { getPipeline9ClearanceMarginErrors } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9ClearanceMarginErrors"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

const getCircuitJson = (routes: HighDensityRoute[]): AnyCircuitElement[] => {
  const owner = routes[0]!
  const via = owner.vias[0]!
  const signal = routes[1]!
  const ownerRoute: Extract<AnyCircuitElement, { type: "pcb_trace" }>["route"] =
    []
  for (const [index, point] of owner.route.entries()) {
    const layer = point.z === 0 ? "top" : "bottom"
    ownerRoute.push({
      route_type: "wire",
      x: point.x,
      y: point.y,
      width: 0.1,
      layer,
    })
    const next = owner.route[index + 1]
    if (next && point.z !== next.z) {
      ownerRoute.push({
        route_type: "via",
        x: point.x,
        y: point.y,
        from_layer: layer,
        to_layer: next.z === 0 ? "top" : "bottom",
      })
    }
  }
  return [
    {
      type: "pcb_via",
      pcb_via_id: "via_0",
      pcb_trace_id: "via_owner_0",
      x: via.x,
      y: via.y,
      outer_diameter: 0.3,
      hole_diameter: 0.15,
      layers: ["top", "bottom"],
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "via_owner_0",
      route: ownerRoute,
    },
    {
      type: "pcb_trace",
      pcb_trace_id: "signal_0",
      route: signal.route.map((point) => ({
        route_type: "wire" as const,
        x: point.x,
        y: point.y,
        width: 0.1,
        layer: "top" as const,
      })),
    },
  ]
}

test("clearance precision keeps a relaxed-clean candidate private until its physical margin passes", (): void => {
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
  let cleanCandidatesWithoutMargin = 0
  let referenceChecks = 0
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
    indexedDrcEvaluator: () => [],
    candidateDrcEvaluator: () => ({ errors: [], errorsWithCenters: [] }),
    marginDrcEvaluator: (candidateRoutes, targets, initialRoutes) => {
      const circuitJson = getCircuitJson(candidateRoutes)
      const errors = getPipeline9ClearanceMarginErrors({
        circuitJson,
        originalCircuitJson: getCircuitJson(initialRoutes),
        targets,
      })
      if (
        errors.length > 0 &&
        checkViaTraceClearance(circuitJson, { minClearance: 0.1 }).length === 0
      ) {
        cleanCandidatesWithoutMargin++
      }
      return errors
    },
    drcEvaluator: ({ routes: candidateRoutes }) => {
      referenceChecks++
      const measured = checkViaTraceClearance(
        getCircuitJson(candidateRoutes!),
        {
          minClearance: 0.2,
        },
      )
      expect(measured).toHaveLength(1)
      expect(measured[0]!.actual_clearance).toBeGreaterThanOrEqual(0.11)
      return { errors: [], errorsWithCenters: [] }
    },
  })
  expect(cleanCandidatesWithoutMargin).toBeGreaterThan(0)
  expect(result.repaired).toBeTrue()
  expect(result.routes).not.toBe(routes)
  expect(routes).toEqual(originalRoutes)
  expect(referenceChecks).toBe(1)
  expect(result.referenceValidationCount).toBe(1)
  expect(result.candidateValidationCount).toBeGreaterThan(1)
  expect(result.candidateValidationCount).toBeLessThanOrEqual(8)
  expect(result.attemptedCandidateCount).toBeLessThanOrEqual(24)
})
