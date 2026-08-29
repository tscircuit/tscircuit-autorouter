import { expect, test } from "bun:test"
import { findCoupledRouteConstraintViolation } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/coupled-route-constraints"
import type { HybridCopperSegment } from "lib/autorouter-pipelines/AutoroutingPipeline12_HybridTransactionalRouter/transactional-copper-types"
import { createHybridRoutingTestProblem } from "./fixtures"

test("accepts a connected power tree and rejects a copper cycle", () => {
  const problem = createHybridRoutingTestProblem()
  const createSegment = (
    copperId: string,
    start: { readonly x: number; readonly y: number },
    end: { readonly x: number; readonly y: number },
  ): HybridCopperSegment => ({
    kind: "segment",
    copperId,
    connectionName: "power_vcc",
    layer: "top",
    start,
    end,
    widthMm: 0.5,
    ownership: {
      mutability: "mutable",
      ownerRouteObjectIds: ["power:power_vcc"],
    },
  })
  const tree = [
    createSegment("power:left", { x: -8, y: 1.5 }, { x: 0, y: 1.5 }),
    createSegment("power:right", { x: 0, y: 1.5 }, { x: 8, y: 1.5 }),
  ]
  const affectedConnectionNames = new Set(["power_vcc"])

  expect(
    findCoupledRouteConstraintViolation({
      compiledRules: problem.compiledRules,
      copperSnapshot: { version: 0, segments: tree, vias: [] },
      affectedConnectionNames,
    }),
  ).toBeUndefined()

  const cycle = [
    ...tree,
    createSegment("power:cycle:0", { x: 0, y: 1.5 }, { x: 1, y: 2.5 }),
    createSegment("power:cycle:1", { x: 1, y: 2.5 }, { x: 2, y: 1.5 }),
    createSegment("power:cycle:2", { x: 2, y: 1.5 }, { x: 0, y: 1.5 }),
  ]
  expect(
    findCoupledRouteConstraintViolation({
      compiledRules: problem.compiledRules,
      copperSnapshot: { version: 0, segments: cycle, vias: [] },
      affectedConnectionNames,
    })?.code,
  ).toBe("power_constraint_violation")
})
