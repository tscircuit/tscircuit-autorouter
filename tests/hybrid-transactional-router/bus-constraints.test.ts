import { expect, test } from "bun:test"
import { findCoupledRouteConstraintViolation } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/coupled-route-constraints"
import type { HybridCopperSegment } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-types"
import { createHybridRoutingTestProblem } from "./fixtures"

test("enforces physical bus order and maximum routed-length skew", () => {
  const problem = createHybridRoutingTestProblem()
  const createPath = (
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
      widthMm: 0.16,
      ownership: {
        mutability: "mutable",
        ownerRouteObjectIds: ["bus:control_bus"],
      },
    }))
  const busZero = createPath("bus_0", [
    { x: -8, y: -0.5 },
    { x: 8, y: -0.5 },
  ])
  const busOne = createPath("bus_1", [
    { x: -8, y: 0.5 },
    { x: 8, y: 0.5 },
  ])
  const affectedConnectionNames = new Set(["bus_0", "bus_1"])

  expect(
    findCoupledRouteConstraintViolation({
      compiledRules: problem.compiledRules,
      copperSnapshot: { version: 0, segments: [...busZero, ...busOne], vias: [] },
      affectedConnectionNames,
    }),
  ).toBeUndefined()

  const skewedBusOne = createPath("bus_1", [
    { x: -8, y: 0.5 },
    { x: 0, y: 3 },
    { x: 8, y: 0.5 },
  ])
  expect(
    findCoupledRouteConstraintViolation({
      compiledRules: problem.compiledRules,
      copperSnapshot: {
        version: 0,
        segments: [...busZero, ...skewedBusOne],
        vias: [],
      },
      affectedConnectionNames,
    })?.code,
  ).toBe("bus_constraint_violation")
})
