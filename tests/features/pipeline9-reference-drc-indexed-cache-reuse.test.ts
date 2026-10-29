import { expect, test } from "bun:test"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { issue3130Input } from "../fixtures/issue3130-via-pad-clearance"

type RepairEvaluators = {
  drcEvaluator: DrcEvaluator
  cachedReferenceDrcEvaluator: DrcEvaluator
  referenceDrcValidationCount: number
  indexedDrcCandidateCache: Map<string, unknown>
}

test("reference DRC reuses only full validations retained in the bounded indexed cache", (): void => {
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
  const createSolver = (): RepairEvaluators => {
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
    }) as unknown as RepairEvaluators
  }
  const evaluate = (
    evaluator: DrcEvaluator,
    candidate: HighDensityRoute[],
  ): ReturnType<DrcEvaluator> => {
    return evaluator({ traces: [], routes: candidate, hdRoutes: candidate })
  }
  const coldReference = (
    candidate: HighDensityRoute[],
  ): ReturnType<DrcEvaluator> => {
    const cold = createSolver()
    const result = evaluate(cold.cachedReferenceDrcEvaluator, candidate)
    expect(cold.referenceDrcValidationCount).toBe(1)
    return result
  }
  const clean = structuredClone(routes)
  for (const route of clean) {
    const x = route.vias[0]!.x
    route.vias[0]!.x = 1.1
    for (const point of route.route) {
      if (point.x === x) point.x = 1.1
    }
  }
  const solver = createSolver()
  const cleanResult = evaluate(solver.drcEvaluator, clean)
  expect(cleanResult).toEqual(coldReference(clean))
  expect(solver.referenceDrcValidationCount).toBe(1)

  // Two other reference geometries evict the clean result from the existing
  // two-entry cache. The indexed cache still owns its complete validation.
  const other = structuredClone(routes)
  other[0]!.route[1]!.y += 0.01
  for (const candidate of [routes, other]) {
    expect(evaluate(solver.cachedReferenceDrcEvaluator, candidate)).toEqual(
      coldReference(candidate),
    )
  }
  expect(solver.referenceDrcValidationCount).toBe(3)
  expect(
    evaluate(solver.cachedReferenceDrcEvaluator, structuredClone(clean)),
  ).toEqual(cleanResult)
  expect(solver.referenceDrcValidationCount).toBe(3)
  expect(evaluate(solver.drcEvaluator, clean)).toEqual(cleanResult)

  // Reusing the same array after changing copper must never reuse its old
  // validation, even though another geometry remains indexed and validated.
  const changed = structuredClone(clean)
  expect(evaluate(solver.cachedReferenceDrcEvaluator, changed)).toEqual(
    cleanResult,
  )
  expect(solver.referenceDrcValidationCount).toBe(3)
  changed[0]!.vias[0]!.x = 0.96
  for (const point of changed[0]!.route) {
    if (point.x === 1.1) point.x = 0.96
  }
  expect(evaluate(solver.cachedReferenceDrcEvaluator, changed)).toEqual(
    coldReference(changed),
  )
  expect(solver.referenceDrcValidationCount).toBe(4)

  // A real nonzero indexed evaluation is not a full reference validation.
  // The reference consumer must call the checker and return its exact errors,
  // centers, identifiers and ordering, preserving indexed ranking separately.
  const dirtySolver = createSolver()
  const overlapping = structuredClone(clean)
  for (const point of overlapping[1]!.route) point.y -= 3
  overlapping[1]!.vias[0]!.y -= 3
  const indexedDirty = evaluate(dirtySolver.drcEvaluator, overlapping)
  expect(dirtySolver.referenceDrcValidationCount).toBe(0)
  expect(evaluate(dirtySolver.cachedReferenceDrcEvaluator, overlapping)).toEqual(
    coldReference(overlapping),
  )
  expect(dirtySolver.referenceDrcValidationCount).toBe(1)
  expect(evaluate(dirtySolver.drcEvaluator, overlapping)).toEqual(indexedDirty)

  // Indexed zero is not reference zero: the via-pad reproduction has two
  // reference errors. Retaining it must preserve those errors, not its indexed
  // predecessor or an inferred clean result.
  const falseNegativeSolver = createSolver()
  const falseNegative = evaluate(falseNegativeSolver.drcEvaluator, routes)
  expect(
    Array.isArray(falseNegative) ? falseNegative : falseNegative.errors,
  ).toHaveLength(2)
  expect(falseNegative).toEqual(coldReference(routes))
  for (const candidate of [clean, other]) {
    evaluate(falseNegativeSolver.cachedReferenceDrcEvaluator, candidate)
  }
  const beforeFalseNegativeReturn =
    falseNegativeSolver.referenceDrcValidationCount
  expect(
    evaluate(falseNegativeSolver.cachedReferenceDrcEvaluator, routes),
  ).toEqual(falseNegative)
  expect(falseNegativeSolver.referenceDrcValidationCount).toBe(
    beforeFalseNegativeReturn,
  )

  // A bridge hit warms the same two-entry reference FIFO as a complete check.
  // It therefore remains reusable after the indexed cache's 64-entry eviction.
  for (let index = 0; index < 64; index++) {
    const candidate = structuredClone(overlapping)
    candidate[0]!.route[1]!.y += (index + 1) / 10000
    evaluate(solver.drcEvaluator, candidate)
  }
  expect(solver.indexedDrcCandidateCache.size).toBe(64)
  expect(solver.indexedDrcCandidateCache.has(JSON.stringify(clean))).toBe(
    false,
  )
  const beforeEvictedReference = solver.referenceDrcValidationCount
  expect(evaluate(solver.cachedReferenceDrcEvaluator, clean)).toEqual(
    coldReference(clean),
  )
  expect(solver.referenceDrcValidationCount).toBe(beforeEvictedReference)

  // Once both existing caches evict it, the complete checker runs again. No
  // separate strong cache may preserve a validation outside those bounds.
  for (const candidate of [routes, other]) {
    expect(evaluate(solver.cachedReferenceDrcEvaluator, candidate)).toEqual(
      coldReference(candidate),
    )
  }
  const beforeBothCachesEvicted = solver.referenceDrcValidationCount
  expect(evaluate(solver.cachedReferenceDrcEvaluator, clean)).toEqual(
    coldReference(clean),
  )
  expect(solver.referenceDrcValidationCount).toBe(beforeBothCachesEvicted + 1)
})
