import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import {
  makeCrossingSingleLayerNode,
  makeNode,
  makeScaledRoute,
} from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver opts into original-scale validation and fail-loud behavior", async () => {
  const attemptedScaledRoute = makeScaledRoute()
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
    maxGrowthAttempts: 1,
    growShrinkRequireOriginalScaleValidation: true,
  })
  solver.scaleFactor = 2
  solver.growthAttempts = 1
  solver.activeSubSolver = {
    failed: false,
    solved: false,
    error: null,
    solvedRoutes: [attemptedScaledRoute],
    step() {
      this.solved = true
    },
    visualize() {
      return {
        title: "Scaled candidate rejected at original size",
        lines: attemptedScaledRoute.route.slice(0, -1).map((point, index) => ({
          points: [point, attemptedScaledRoute.route[index + 1]!],
          strokeColor: "#dc2626",
          strokeWidth: attemptedScaledRoute.traceThickness,
          label: `${attemptedScaledRoute.connectionName} candidate`,
        })),
        points: makeNode().portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          color: "#2563eb",
          label: `${point.connectionName} z${point.z}`,
        })),
        rects: [
          {
            center: makeNode().center,
            width: makeNode().width,
            height: makeNode().height,
            fill: "rgba(239, 68, 68, 0.10)",
            stroke: "#dc2626",
            label: "original physical size",
          },
        ],
        circles: [],
      }
    },
  } as any

  solver.step()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.solvedRoutes).toEqual([])
  expect(solver.error).toContain(
    "scaled solutions require validation at the original scale",
  )
  await expect(
    getSvgFromGraphicsObject(solver.visualize()),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "rejected-scaled-route" })

  const impossibleSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeCrossingSingleLayerNode(),
    fallbackToInvalidGeometryOnFailure: true,
    growShrinkRequireOriginalScaleValidation: true,
  })
  expect(impossibleSolver.solved).toBe(false)
  expect(impossibleSolver.failed).toBe(true)
  expect(impossibleSolver.solvedRoutes).toEqual([])
  expect(impossibleSolver.error).toContain(
    "cannot route an impossible single-layer crossing",
  )
  await expect(
    getSvgFromGraphicsObject(impossibleSolver.visualize()),
  ).toMatchSvgSnapshot(import.meta.path, {
    svgName: "impossible-single-layer-crossing",
  })
})
