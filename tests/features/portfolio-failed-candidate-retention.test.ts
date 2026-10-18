import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import nodeJson from "../fixtures/srj18-sample15-sub-via-node.json"

test("discarding failed portfolio candidates preserves scheduling, budgets and errors", (): void => {
  let releasedCandidateCount = 0
  for (const scale of [1, 16]) {
    const node: NodeWithPortPoints = structuredClone(nodeJson)
    node.width *= scale
    node.height *= scale
    const portPoints = new Set([
      ...node.portPoints,
      ...(node.portPointsInPairs?.flat() ?? []),
    ])
    for (const point of portPoints) {
      point.x = node.center.x + (point.x - node.center.x) * scale
      point.y = node.center.y + (point.y - node.center.y) * scale
    }
    const options = {
      nodeWithPortPoints: node,
      traceWidth: 0.1,
      viaDiameter: 0.3,
      obstacleMargin: 0.15,
      layerCount: 4,
      enableNegotiatedSearch: true,
      cacheProvider: null,
    }
    const debugSolver = new PortfolioSingleIntraNodeSolver(options)
    const solver = new PortfolioSingleIntraNodeSolver({
      ...options,
      nodeWithPortPoints: structuredClone(node),
      captureSearchDebug: false,
    })
    while (!debugSolver.solved && !debugSolver.failed) {
      debugSolver.step()
      solver.step()
      expect(solver.solved).toBe(debugSolver.solved)
      expect(solver.failed).toBe(debugSolver.failed)
      expect(solver.error).toBe(debugSolver.error)
      expect(solver.MAX_ITERATIONS).toBe(debugSolver.MAX_ITERATIONS)
      expect(solver.stats).toEqual(debugSolver.stats)
      const nextCandidate = solver.getSupervisedSolverWithBestFitness()
      const nextDebugCandidate =
        debugSolver.getSupervisedSolverWithBestFitness()
      expect(nextCandidate?.hyperParameters).toEqual(
        nextDebugCandidate?.hyperParameters,
      )
      if (debugSolver.activeSubSolver?.failed) {
        expect(solver.activeSubSolver).toBeNull()
        expect(
          solver.supervisedSolvers!.some(
            ({ solver: candidate }) =>
              candidate.getSolverName() ===
                debugSolver.activeSubSolver!.getSolverName() &&
              candidate.failed &&
              candidate.iterations > 0,
          ),
        ).toBe(false)
      }
    }
    releasedCandidateCount +=
      debugSolver.supervisedSolvers!.length - solver.supervisedSolvers!.length
    expect(solver.solved).toBe(scale === 16)
    expect(solver.failed).toBe(scale === 1)
    expect(solver.solvedRoutes).toEqual(debugSolver.solvedRoutes)
    expect(solver.iterations).toBe(debugSolver.iterations)
    expect(solver.progress).toBe(debugSolver.progress)
  }
  expect(releasedCandidateCount).toBeGreaterThan(0)
})
