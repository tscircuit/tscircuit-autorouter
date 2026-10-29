import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { issue3130Input } from "../fixtures/issue3130-via-pad-clearance"

type ReferenceEvaluator = {
  cachedReferenceDrcEvaluator: DrcEvaluator
  referenceDrcValidationCount: number
}

test("reference DRC retains four geometries with exact errors and bounded FIFO eviction", (): void => {
  const srj = structuredClone(issue3130Input)
  const routes: HighDensityRoute[] = [0.95, 0.97].map(
    (x, index): HighDensityRoute => {
      const y = index * 3
      return {
        connectionName: `escape_${index}`,
        rootConnectionName: `escape_${index}`,
        traceThickness: 0.1,
        viaDiameter: 0.6,
        route: [
          { x: 2, y, z: 0, pcb_port_id: `start_${index}` },
          { x, y, z: 0 },
          { x, y, z: 1 },
          { x: 2, y: y + 1, z: 1, pcb_port_id: `end_${index}` },
        ],
        vias: [{ x, y }],
      }
    },
  )
  const createSolver = (): Pipeline9JointDrcRepairSolver => {
    return new Pipeline9JointDrcRepairSolver({
      srj,
      originalSrj: srj,
      srjWithPointPairs: srj,
      newConnections: srj.connections,
      newHdRoutes: routes,
      updatedPreloadedTraces: [],
      mutatedPreloadedTraceIds: new Set(),
      connMap: getConnectivityMapFromSimpleRouteJson(srj),
      obstacles: srj.obstacles,
      layerCount: srj.layerCount,
      defaultViaDiameter: 0.6,
      defaultViaHoleDiameter: 0.3,
      effort: 1,
      colorMap: {},
    })
  }
  const reference = createSolver() as unknown as ReferenceEvaluator
  const evaluate = (
    candidate: HighDensityRoute[],
  ): Array<Record<string, unknown>> => {
    const result = reference.cachedReferenceDrcEvaluator({
      traces: [],
      routes: candidate,
      hdRoutes: candidate,
    })
    // A fresh solver has no candidate cache: compare complete normalized
    // errors, centers, identifiers and their order against the full checker.
    const cold = createSolver() as unknown as ReferenceEvaluator
    const expected = cold.cachedReferenceDrcEvaluator({
      traces: [],
      routes: candidate,
      hdRoutes: candidate,
    })
    expect(cold.referenceDrcValidationCount).toBe(1)
    expect(result).toEqual(expected)
    return Array.isArray(result) ? result : result.errors
  }
  const original = evaluate(routes)
  expect(original).toHaveLength(2)
  const proposal = structuredClone(routes)
  for (const route of proposal) {
    const x = route.vias[0]!.x
    route.vias[0]!.x = 1.1
    for (const point of route.route) {
      if (point.x === x) point.x = 1.1
    }
  }
  expect(evaluate(proposal)).toHaveLength(0)
  const cleanProposal = structuredClone(proposal)
  const validationsBeforeReturn = reference.referenceDrcValidationCount
  expect(evaluate(routes)).toEqual(original)
  expect(reference.referenceDrcValidationCount).toBe(validationsBeforeReturn)

  // A reused array with changed geometry still requires the complete checker.
  proposal[0]!.vias[0]!.x = 0.96
  for (const point of proposal[0]!.route) {
    if (point.x === 1.1) point.x = 0.96
  }
  const changed = evaluate(proposal)
  expect(changed).toHaveLength(1)
  expect(changed[0]).toMatchObject({
    type: "pcb_pad_pad_clearance_error",
    pcb_trace_id: "escape_0_0",
    minimum_clearance: 0.2,
  })
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 1,
  )
  expect(evaluate(cleanProposal)).toHaveLength(0)
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 1,
  )
  // The original survives a third geometry and repeated accepted proposals.
  expect(evaluate(routes)).toEqual(original)
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 1,
  )

  const fourth = structuredClone(routes)
  fourth[0]!.route[1]!.y += 0.01
  expect(evaluate(fourth)).toHaveLength(2)
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 2,
  )
  for (const candidate of [routes, cleanProposal, proposal, fourth]) {
    evaluate(candidate)
  }
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 2,
  )

  const fifth = structuredClone(fourth)
  fifth[1]!.route[1]!.y += 0.01
  expect(evaluate(fifth)).toHaveLength(2)
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 3,
  )
  // Hits preserve FIFO insertion order. The fifth geometry evicts only the
  // oldest; rechecking it then evicts the second, proving the four-entry bound.
  for (const candidate of [cleanProposal, proposal, fourth, fifth]) {
    evaluate(candidate)
  }
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 3,
  )
  expect(evaluate(routes)).toEqual(original)
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 4,
  )
  expect(evaluate(cleanProposal)).toHaveLength(0)
  expect(reference.referenceDrcValidationCount).toBe(
    validationsBeforeReturn + 5,
  )
})
