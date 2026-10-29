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

test("two-entry reference DRC LRU retains a revisited anchor with exact mutable-geometry validation", (): void => {
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
  const createSolver = (): ReferenceEvaluator => {
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
    }) as unknown as ReferenceEvaluator
  }
  const evaluate = (
    owner: ReferenceEvaluator,
    candidate: HighDensityRoute[],
  ): ReturnType<DrcEvaluator> => {
    return owner.cachedReferenceDrcEvaluator({
      traces: [],
      routes: candidate,
      hdRoutes: candidate,
    })
  }
  const reference = createSolver()
  const evaluateAgainstCold = (
    candidate: HighDensityRoute[],
  ): ReturnType<DrcEvaluator> => {
    const result = evaluate(reference, candidate)
    const cold = createSolver()
    const expected = evaluate(cold, candidate)
    expect(cold.referenceDrcValidationCount).toBe(1)
    expect(result).toEqual(expected)
    return result
  }
  const anchor = structuredClone(routes)
  const clean = structuredClone(routes)
  for (const route of clean) {
    const x = route.vias[0]!.x
    route.vias[0]!.x = 1.1
    for (const point of route.route) {
      if (point.x === x) point.x = 1.1
    }
  }
  const third = structuredClone(routes)
  third[0]!.route[1]!.y += 0.01
  const originalErrors = evaluateAgainstCold(anchor)
  evaluateAgainstCold(clean)
  expect(reference.referenceDrcValidationCount).toBe(2)
  evaluateAgainstCold(structuredClone(anchor))
  evaluateAgainstCold(third)
  expect(reference.referenceDrcValidationCount).toBe(3)
  // A, B, A, C, A keeps the repeatedly requested A. FIFO would recompute it.
  expect(evaluateAgainstCold(anchor)).toEqual(originalErrors)
  expect(reference.referenceDrcValidationCount).toBe(3)

  // Refreshes do not expand the cache. B was evicted, then C is evicted when
  // B returns; the frequently reused A remains resident in both transitions.
  evaluateAgainstCold(clean)
  expect(reference.referenceDrcValidationCount).toBe(4)
  evaluateAgainstCold(anchor)
  expect(reference.referenceDrcValidationCount).toBe(4)
  evaluateAgainstCold(third)
  expect(reference.referenceDrcValidationCount).toBe(5)
  evaluateAgainstCold(anchor)
  expect(reference.referenceDrcValidationCount).toBe(5)

  // An array identity is not a geometry identity. Editing the previously
  // evaluated anchor must invoke the complete checker and change its errors.
  const originalAnchor = structuredClone(anchor)
  anchor[0]!.vias[0]!.x = 1.1
  for (const point of anchor[0]!.route) {
    if (point.x === 0.95) point.x = 1.1
  }
  const changed = evaluateAgainstCold(anchor)
  expect(reference.referenceDrcValidationCount).toBe(6)
  expect(Array.isArray(changed) ? changed : changed.errors).toHaveLength(1)
  expect(evaluateAgainstCold(originalAnchor)).toEqual(originalErrors)
  expect(reference.referenceDrcValidationCount).toBe(6)
  evaluateAgainstCold(clean)
  expect(reference.referenceDrcValidationCount).toBe(7)
  evaluateAgainstCold(anchor)
  expect(reference.referenceDrcValidationCount).toBe(8)
})
