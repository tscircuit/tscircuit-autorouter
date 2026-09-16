import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  normalizePipeline9NodeRootConnectionNames,
  Pipeline9HighDensitySolver,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { highDensityFailureCacheNode } from "../fixtures/high-density-failure-cache-node"

const getPortfolio = (
  highDensitySolver: HighDensitySolver,
): PortfolioSingleIntraNodeSolver => {
  highDensitySolver.step()
  const growShrinkSolver = highDensitySolver.activeSubSolver
  if (!(growShrinkSolver instanceof GrowShrinkHighDensityIntraNodeSolver)) {
    throw new Error("Expected a grow/shrink solver for the active node")
  }
  growShrinkSolver.step()
  const portfolio = growShrinkSolver.activeSubSolver
  if (!(portfolio instanceof PortfolioSingleIntraNodeSolver)) {
    throw new Error("Expected an active high-density portfolio")
  }
  return portfolio
}

test("Pipeline9 shares failures with regional retries and isolates routing runs", (): void => {
  const connMap = new ConnectivityMap({})
  const nodeWithPortPoints = normalizePipeline9NodeRootConnectionNames(
    highDensityFailureCacheNode,
    connMap,
  )
  const params = {
    nodePortPoints: [nodeWithPortPoints],
    fixedHdRoutes: [],
    connMap,
    obstacles: [],
    layerCount: 2,
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    effort: 1,
  }
  const pipeline = new Pipeline9HighDensitySolver(params)
  pipeline.step()
  if (!pipeline.activeRegularSolver) {
    throw new Error("Expected a regular high-density search")
  }
  const original = getPortfolio(pipeline.activeRegularSolver).generateSolver({
    HIGH_DENSITY_A01: true,
  })
  original.MAX_ITERATIONS = 3
  original.solve()
  expect(original.failed).toBeTrue()

  const regional = new Pipeline9RegionalFallbackSolver(
    { ...params, nodeWithPortPoints, colorMap: {} },
    pipeline.highDensitySolverFailureCache,
  )
  const retry = getPortfolio(regional.highDensitySolver).generateSolver({
    HIGH_DENSITY_A01: true,
  })
  retry.MAX_ITERATIONS = 3
  retry.step()
  expect(retry.failed).toBeTrue()
  expect(retry.error).toBe(original.error)
  expect(retry.stats.failureCacheHit).toBeTrue()

  const independentPipeline = new Pipeline9HighDensitySolver(params)
  independentPipeline.step()
  if (!independentPipeline.activeRegularSolver) {
    throw new Error("Expected an independent high-density search")
  }
  const independent = getPortfolio(
    independentPipeline.activeRegularSolver,
  ).generateSolver({ HIGH_DENSITY_A01: true })
  independent.MAX_ITERATIONS = 3
  independent.step()
  expect(independent.failed).toBeFalse()
  expect(independent.stats.failureCacheHit).not.toBeTrue()
})
