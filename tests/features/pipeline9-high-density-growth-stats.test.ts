import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import {
  makeNode,
  makeStraightRoute,
} from "./never-fail-growth-high-density/test-helpers"

test("Pipeline9 exposes ordinary high-density growths in its stage stats", () => {
  const growShrinkSolver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
  })
  growShrinkSolver.solved = true
  growShrinkSolver.solvedRoutes = [makeStraightRoute()]
  growShrinkSolver.growthAttempts = 2

  const regularSolver = new HighDensitySolver({
    nodePortPoints: [],
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })
  regularSolver.activeSubSolver = growShrinkSolver

  const pipeline9Solver = new Pipeline9HighDensitySolver({
    nodePortPoints: [],
    fixedHdRoutes: [],
    connMap: new ConnectivityMap({}),
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
  })
  pipeline9Solver.activeRegularSolver = regularSolver

  pipeline9Solver.step()

  expect(pipeline9Solver.stats.highDensityResizeCount).toBe(2)
})
