import { expect, test } from "bun:test"
import { findCoupledRouteConstraintViolation } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/coupled-route-constraints"
import type { HybridCopperSegment } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-types"
import { createHybridRoutingTestProblem } from "./fixtures"

test("accepts tuned pair copper and rejects excessive uncoupled length", () => {
  const problem = createHybridRoutingTestProblem()
  const ownerRouteObjectId =
    "differential_pair:diff_positive:diff_negative"
  const createSegments = (
    connectionName: string,
    points: readonly { readonly x: number; readonly y: number }[],
  ): readonly HybridCopperSegment[] =>
    points.slice(0, -1).map((point, pointIndex) => ({
      kind: "segment",
      copperId: `${connectionName}:${pointIndex}`,
      connectionName,
      layer: "top",
      start: point,
      end: points[pointIndex + 1]!,
      widthMm: 0.15,
      ownership: {
        mutability: "mutable",
        ownerRouteObjectIds: [ownerRouteObjectId],
      },
    }))
  const positive = createSegments("diff_positive", [
    { x: -8, y: -2.5 },
    { x: -7.7, y: -2.165 },
    { x: 7.7, y: -2.165 },
    { x: 8, y: -2.5 },
  ])
  const negative = createSegments("diff_negative", [
    { x: -8, y: -1.5 },
    { x: -7.7, y: -1.835 },
    { x: 7.7, y: -1.835 },
    { x: 8, y: -1.5 },
  ])
  const affectedConnectionNames = new Set([
    "diff_positive",
    "diff_negative",
  ])

  expect(
    findCoupledRouteConstraintViolation({
      compiledRules: problem.compiledRules,
      copperSnapshot: { version: 0, segments: [...positive, ...negative], vias: [] },
      affectedConnectionNames,
    }),
  ).toBeUndefined()

  const uncoupledNegative = createSegments("diff_negative", [
    { x: -8, y: -1.5 },
    { x: 8, y: -1.5 },
  ])
  expect(
    findCoupledRouteConstraintViolation({
      compiledRules: problem.compiledRules,
      copperSnapshot: {
        version: 0,
        segments: [...positive, ...uncoupledNegative],
        vias: [],
      },
      affectedConnectionNames,
    })?.code,
  ).toBe("differential_pair_constraint_violation")
})
