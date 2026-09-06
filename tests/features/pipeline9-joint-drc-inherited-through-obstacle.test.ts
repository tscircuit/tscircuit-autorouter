import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 repairs inherited wire sections without moving through-obstacle copper", (): void => {
  const { srj, originalSrj, trace, solver } =
    createPipeline9InheritedPadClearanceFixture(true)
  const protectedSpan = trace.route.find(
    (point) => point.route_type === "through_obstacle",
  )
  if (!protectedSpan || protectedSpan.route_type !== "through_obstacle") {
    throw new Error("Expected a protected through-obstacle primitive")
  }
  const baseline = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [],
  })
  expect(baseline.errors).toHaveLength(1)
  expect(solver.movablePreloadedSections).toHaveLength(2)
  expect(solver.fixedPreloadedObstacleRoutes).toHaveLength(1)
  expect(solver.fixedPreloadedObstacleRoutes[0]?.isThroughObstacle).toBeTrue()
  for (const section of solver.movablePreloadedSections) {
    expect(
      trace.route
        .slice(
          section.originalRoutePositionStart,
          section.originalRoutePositionEnd + 1,
        )
        .some((point) => point.route_type === "through_obstacle"),
    ).toBeFalse()
  }

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const repaired = solver.getMutatedPreloadedTraces()
  expect(repaired).toHaveLength(1)
  const repairedRoute = repaired[0]!.route
  const spanIndex = repairedRoute.findIndex(
    (point) => point.route_type === "through_obstacle",
  )
  expect(spanIndex).toBeGreaterThan(0)
  expect(repairedRoute[spanIndex]).toEqual(protectedSpan)
  expect(repairedRoute[spanIndex - 1]).toMatchObject({
    route_type: "wire",
    ...protectedSpan.start,
    layer: protectedSpan.from_layer,
  })
  expect(repairedRoute[spanIndex + 1]).toMatchObject({
    route_type: "wire",
    ...protectedSpan.end,
    layer: protectedSpan.to_layer,
  })
  expect(repairedRoute[0]).toEqual(trace.route[0])
  expect(repairedRoute.at(-1)).toEqual(trace.route.at(-1))
  expect(
    evaluateRelaxedDrc({
      inputSrj: srj,
      srjWithPointPairs: srj,
      routedTraces: repaired,
    }).errors,
  ).toHaveLength(0)
  expect(srj).toEqual(originalSrj)
})
