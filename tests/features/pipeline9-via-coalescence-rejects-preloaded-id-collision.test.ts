import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9FinalViaMergeSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalViaMergeSolver"
import {
  addAutoroutingViaTraceIds,
  remapDrcTraceIds,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { normalizePipeline9DrcErrorsForRepair } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/normalizePipeline9DrcErrorsForRepair"
import type { Pipeline9DrcError } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { createPipeline9ViaCoalescenceFixture } from "../fixtures/pipeline9-via-coalescence-fixture"

type PreparedReference = {
  errors: Pipeline9DrcError[]
  circuitJson: AnyCircuitElement[]
  originalCircuitJson: AnyCircuitElement[]
  evaluatedNewTraceIds: string[]
}

test("declines via ownership when a normalized new trace id collides with immutable preload copper", (): void => {
  const fixture = createPipeline9ViaCoalescenceFixture()
  const fixedRoute = fixture.routes.pop()!
  const collidedId = `${fixture.routes[0]!.connectionName}_0`
  const preloadedTraces: SimplifiedPcbTrace[] = [
    {
      type: "pcb_trace",
      pcb_trace_id: collidedId,
      connection_name: fixedRoute.connectionName,
      route: convertHdRouteToSimplifiedRoute(fixedRoute, 2, {
        defaultViaHoleDiameter: 0.2,
      }),
    },
  ]
  fixture.srj.traces = preloadedTraces
  const original = structuredClone({
    routes: fixture.routes,
    fixedRoute,
    srj: fixture.srj,
  })
  const prepareReference = (routes: HighDensityRoute[]): PreparedReference => {
    const rawNewTraces: SimplifiedPcbTrace[] = routes.map((route) => ({
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_0`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, 2, {
        defaultViaHoleDiameter: 0.2,
      }),
    }))
    const newTraces = assignUniquePcbTraceIdsToNewTraces(
      rawNewTraces,
      preloadedTraces,
    )
    const solverIdByEvaluationId = new Map(
      newTraces.map((trace, index) => [
        trace.pcb_trace_id,
        rawNewTraces[index]!.pcb_trace_id,
      ]),
    )
    const reference = evaluateRelaxedDrc({
      inputSrj: fixture.srj,
      srjWithPointPairs: fixture.srj,
      routedTraces: newTraces,
      includeBoardClearance: true,
      drcOptions: { viaClearance: 0.1, traceClearance: 0.01 },
    })
    const withOwners = addAutoroutingViaTraceIds({
      errors: reference.errors as unknown as Pipeline9DrcError[],
      circuitJson: reference.circuitJson,
      evaluatedTraceIds: new Set(
        [...preloadedTraces, ...newTraces].map((trace) => trace.pcb_trace_id),
      ),
    })
    const circuitJson = reference.circuitJson.map((element) => {
      if (!("pcb_trace_id" in element) || typeof element.pcb_trace_id !== "string")
        return element
      const solverId = solverIdByEvaluationId.get(element.pcb_trace_id)
      return solverId ? { ...element, pcb_trace_id: solverId } : element
    })
    const errors = normalizePipeline9DrcErrorsForRepair({
      errors: remapDrcTraceIds(withOwners, solverIdByEvaluationId),
      circuitJson,
      newTraceIds: new Set(solverIdByEvaluationId.values()),
    })
    return {
      errors,
      circuitJson,
      originalCircuitJson: reference.circuitJson,
      evaluatedNewTraceIds: newTraces.map((trace) => trace.pcb_trace_id),
    }
  }
  const initial = prepareReference(fixture.routes)
  expect(initial.errors).toHaveLength(1)
  expect(initial.errors[0]!.type).toBe("pcb_via_clearance_error")
  expect(initial.evaluatedNewTraceIds).toEqual([`${collidedId}_routed`])
  expect(
    new Set(
      initial.originalCircuitJson
        .filter((element) => element.type === "pcb_via")
        .map((via) => via.pcb_trace_id),
    ).size,
  ).toBe(2)
  expect(
    new Set(
      initial.circuitJson
        .filter((element) => element.type === "pcb_via")
        .map((via) => via.pcb_trace_id),
    ),
  ).toEqual(new Set([collidedId]))
  const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
    const candidate = routes ?? hdRoutes
    if (!candidate) throw new Error("Collision reference requires candidate routes")
    const reference = prepareReference(candidate)
    return { errors: reference.errors, errorsWithCenters: reference.errors }
  }
  const solver = new Pipeline9FinalViaMergeSolver({
    srj: fixture.srj,
    routes: fixture.routes,
    fixedRoutes: [fixedRoute],
    connMap: fixture.connMap,
    newConnections: fixture.srj.connections,
    syntheticConnectionNames: new Set(),
    drcEvaluator,
    prepareReference,
  })
  solver.solve()
  const result = solver.getResult()
  expect(result.attempted).toBe(false)
  expect(solver.merger).toBeUndefined()
  expect(result.repaired).toBe(false)
  expect(result.remainingDrcIssueCount).toBe(1)
  expect(result.routes).toBe(fixture.routes)
  expect({ routes: fixture.routes, fixedRoute, srj: fixture.srj }).toEqual(original)
})
