import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import fixture from "../fixtures/srj18-cmn70-single-transition-boundary-tolerance.json"

const nodeWithPortPoints: NodeWithPortPoints = fixture.nodeWithPortPoints

test("SRJ18 cmn_70 exposes inconsistent single-transition boundary tolerance", async () => {
  const solver = new SingleTransitionCrossingRouteSolver({
    nodeWithPortPoints,
    viaDiameter: fixture.routingRules.viaDiameter,
    traceThickness: fixture.routingRules.traceWidth,
    obstacleMargin: fixture.routingRules.obstacleMargin,
    layerCount: fixture.routingRules.layerCount,
  })

  expect(solver.failed).toBe(false)
  expect(() => solver.solve()).toThrow(
    "does not lie on the boundary defined by",
  )
  expect(solver.solved).toBe(false)

  await expect(
    getSvgFromGraphicsObject(solver.visualize(), {
      backgroundColor: "#0d1b2a",
      svgWidth: 640,
      svgHeight: 480,
      hideInlineLabels: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { tolerance: 0 })
})
