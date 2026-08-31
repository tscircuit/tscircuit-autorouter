import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import {
  emptyVisualization,
  makeNode,
} from "./never-fail-growth-high-density/test-helpers"

test("Pipeline9 retains growth attempts after its active child is released", () => {
  const pipeline9Solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [makeNode()],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
  })
  pipeline9Solver.step()
  pipeline9Solver.step()

  const growShrinkSolver = pipeline9Solver.activeRegularSolver
    ?.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver
  growShrinkSolver.activeSubSolver = {
    failed: false,
    solved: false,
    error: null,
    solvedRoutes: [],
    step() {
      this.failed = true
      this.error = "forced failure"
    },
    visualize: emptyVisualization,
  } as any

  pipeline9Solver.step()

  expect(pipeline9Solver.getHighDensityGrowthAttemptCount()).toBe(1)
  pipeline9Solver.activeRegularSolver = null
  expect(pipeline9Solver.getHighDensityGrowthAttemptCount()).toBe(1)
})
