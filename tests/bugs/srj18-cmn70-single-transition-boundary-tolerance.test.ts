import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import fixture from "../fixtures/srj18-cmn70-single-transition-boundary-tolerance.json"

const nodeWithPortPoints: NodeWithPortPoints = fixture.nodeWithPortPoints

test("SRJ18 cmn_70 uses consistent single-transition boundary tolerance", async () => {
  const solver = new SingleTransitionCrossingRouteSolver({
    nodeWithPortPoints,
    viaDiameter: fixture.routingRules.viaDiameter,
    traceThickness: fixture.routingRules.traceWidth,
    obstacleMargin: fixture.routingRules.obstacleMargin,
    layerCount: fixture.routingRules.layerCount,
  })

  expect(solver.failed).toBe(false)
  expect(() => solver.solve()).not.toThrow()
  expect(solver.solved).toBe(true)

  const repeatedSolver = new SingleTransitionCrossingRouteSolver({
    nodeWithPortPoints,
    viaDiameter: fixture.routingRules.viaDiameter,
    traceThickness: fixture.routingRules.traceWidth,
    obstacleMargin: fixture.routingRules.obstacleMargin,
    layerCount: fixture.routingRules.layerCount,
  })
  repeatedSolver.solve()

  expect(repeatedSolver.solvedRoutes).toEqual(solver.solvedRoutes)

  await expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "#0d1b2a",
      svgWidth: 640,
      svgHeight: 480,
      hideInlineLabels: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
