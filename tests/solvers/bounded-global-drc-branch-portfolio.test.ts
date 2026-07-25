import { expect, test } from "bun:test"
import type { GraphicsObject } from "graphics-debug"
import { BoundedGlobalDrcBranchPortfolioSolver } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/BoundedGlobalDrcBranchPortfolioSolver"
import { getGraphicsSvgFrames } from "tests/fixtures/solver-svg-frames"
import type {
  GlobalDrcBranchPortfolioSolverParams,
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
import { GlobalDrcBranchPortfolioSolver } from "high-density-repair03/lib"

const srj: SimpleRouteJson = {
  layerCount: 2,
  minTraceWidth: 0.1,
  bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
  obstacles: [],
  connections: [],
}

function makeRoute(index: number, pointCount: number): HighDensityRoute {
  return {
    connectionName: `route_${index}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: pointCount }, (_, pointIndex) => ({
      x: pointIndex * 0.1,
      y: index * 0.1,
      z: 0,
    })),
  }
}

function makeParams(
  hdRoutes: HighDensityRoute[],
  drcEvaluator: GlobalDrcBranchPortfolioSolverParams["drcEvaluator"],
): GlobalDrcBranchPortfolioSolverParams {
  return {
    srj,
    hdRoutes,
    drcEvaluator,
    effort: 1,
    maxIterations: 32,
    broadMaxIterations: 8,
    broadPassMultiplier: 3,
    enableLargeBoardBroadFallback: false,
    enableTargetedErrorSweep: true,
    enablePostSolveClearanceRelaxation: false,
    enableViaInPadLayerMoves: false,
  }
}

function visualizeDrcDecision({
  evaluationCount,
  routeCount,
  workEstimate,
  skipped,
}: {
  evaluationCount: number
  routeCount: number
  workEstimate: number
  skipped: boolean
}): GraphicsObject {
  const routeMarkers = Array.from({ length: 100 }, (_, index) => ({
    center: { x: (index % 20) * 0.22, y: Math.floor(index / 20) * 0.22 },
    width: 0.16,
    height: 0.16,
    fill: skipped ? "#bfdbfe" : "#fde68a",
    stroke: skipped ? "#2563eb" : "#d97706",
  }))
  const thresholdWidth = 4.4
  const workWidth = Math.min(
    thresholdWidth * 1.18,
    (workEstimate / 5_000_000) * thresholdWidth,
  )

  return {
    rects: [
      ...routeMarkers,
      {
        center: { x: thresholdWidth / 2, y: -0.75 },
        width: thresholdWidth,
        height: 0.22,
        fill: "#e2e8f0",
        stroke: "#64748b",
      },
      {
        center: { x: workWidth / 2, y: -0.75 },
        width: workWidth,
        height: 0.22,
        fill: skipped ? "#60a5fa" : "#f59e0b",
        stroke: skipped ? "#1d4ed8" : "#b45309",
      },
    ],
    texts: [
      {
        x: 4.4,
        y: 0.88,
        text: `${routeCount} routes`,
        anchorSide: "center_right",
        fontSize: 0.25,
      },
      {
        x: 4.4,
        y: 0.5,
        text: `${workEstimate.toLocaleString()} estimated checks`,
        anchorSide: "center_right",
        fontSize: 0.22,
      },
      {
        x: 4.4,
        y: 0.12,
        text: `DRC evaluator calls: ${evaluationCount}`,
        anchorSide: "center_right",
        fontSize: 0.22,
      },
      {
        x: 0,
        y: -1.08,
        text: skipped ? "over 5M → preserve routes" : "exact portfolio runs",
        anchorSide: "center_left",
        fontSize: 0.22,
        color: skipped ? "#1d4ed8" : "#92400e",
      },
    ],
  }
}

test("skips impractical exact DRC work without changing small-board behavior", async () => {
  const largeRoutes = Array.from({ length: 500 }, (_, index) =>
    makeRoute(index, 22),
  )
  let unboundedEvaluationCount = 0
  const evaluateUnboundedDrc = () => {
    unboundedEvaluationCount += 1
    return { errors: [], errorsWithCenters: [] }
  }
  const unboundedSolver = new GlobalDrcBranchPortfolioSolver(
    makeParams(largeRoutes, evaluateUnboundedDrc),
  )
  unboundedSolver.step()
  expect(unboundedSolver.solved).toBe(true)
  expect(unboundedEvaluationCount).toBe(1)

  let boundedEvaluationCount = 0
  const evaluateBoundedDrc = () => {
    boundedEvaluationCount += 1
    return { errors: [], errorsWithCenters: [] }
  }
  const largeSolver = new BoundedGlobalDrcBranchPortfolioSolver(
    makeParams(largeRoutes, evaluateBoundedDrc),
  )

  expect(largeSolver.skippedForLargeBoard).toBe(true)
  largeSolver.step()
  expect(largeSolver.solved).toBe(true)
  expect(largeSolver.getOutput()).toBe(largeRoutes)
  expect(boundedEvaluationCount).toBe(0)

  const smallSolver = new BoundedGlobalDrcBranchPortfolioSolver(
    makeParams([makeRoute(0, 2)], evaluateBoundedDrc),
  )
  expect(smallSolver.skippedForLargeBoard).toBe(false)
  smallSolver.step()
  expect(smallSolver.solved).toBe(true)
  expect(boundedEvaluationCount).toBe(1)

  const svg = getGraphicsSvgFrames({
    frames: [
      {
        name: "1 · Before: unconditional exact DRC",
        hideMetadata: true,
        graphics: visualizeDrcDecision({
          evaluationCount: unboundedEvaluationCount,
          routeCount: largeRoutes.length,
          workEstimate: largeSolver.exactDrcWorkEstimate,
          skipped: false,
        }),
      },
      {
        name: "2 · After: bounded large-board finish",
        hideMetadata: true,
        graphics: visualizeDrcDecision({
          evaluationCount: 0,
          routeCount: largeRoutes.length,
          workEstimate: largeSolver.exactDrcWorkEstimate,
          skipped: largeSolver.skippedForLargeBoard,
        }),
      },
    ],
    columns: 2,
  })

  await expect(svg).toMatchSvgSnapshot(import.meta.path, { scale: 2 })
}, 15_000)
