import {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"

export const createLazyPortfolioNode = (connectionCount = 8): NodeWithPortPoints => {
  const portPoints: NodeWithPortPoints["portPoints"] = []
  for (let index = 0; index < connectionCount; index++) {
    const y = connectionCount === 1 ? 0 : -1.6 + index * 3.2 / (connectionCount - 1)
    const z = index % 2
    portPoints.push(
      { connectionName: `connection-${index}`, x: -2, y, z },
      { connectionName: `connection-${index}`, x: 2, y, z },
    )
  }
  return { capacityMeshNodeId: `lazy-policy-${connectionCount}`, center: { x: 0, y: 0 },
    width: 4, height: 4, availableZ: [0, 1], portPoints }
}

export class GridOnlyPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    return [["highDensityA01"], ["highDensityA03"], ["highDensityA13"]]
  }
}

/** Simulates only candidate search outcomes; real setup and class identity remain. */
export class RareOrderingPortfolio extends GridOnlyPortfolio {
  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    const solver = super.generateSolver(hyperParameters)
    const external = solver as unknown as HighDensitySolverA01 | HighDensitySolverA03 | HighDensitySolverA13
    const isA01 = external instanceof HighDensitySolverA01
    const isA13 = external instanceof HighDensitySolverA13
    if (isA13) external.MAX_ITERATIONS = 4096
    const solvedOutput = (): HighDensityIntraNodeRoute[] => {
      const points = this.nodeWithPortPoints.portPoints
      const routes: HighDensityIntraNodeRoute[] = []
      for (let index = 0; index < points.length; index += 2) {
        routes.push({ connectionName: points[index]!.connectionName,
          traceThickness: 0.1, viaDiameter: 0.3,
          route: [{ ...points[index]! }, { ...points[index + 1]! }], vias: [] })
      }
      return routes
    }
    external.step = (): void => {
      if (!external._setupDone) external.setup()
      if (external.solved || external.failed) return
      external.iterations += 256
      external.progress = 0.25
      if (isA13) external.routingIterations += 256
      if (isA01 && hyperParameters.SHUFFLE_SEED === 5 && external.iterations >= 4096) {
        external.solved = true
        external.getOutput = solvedOutput
      } else if (external.iterations >= external.MAX_ITERATIONS) {
        external.failed = true
        external.error = "Deterministic test search allocation exhausted"
      }
    }
    return solver
  }
}

export const policySnapshot = (portfolio: PortfolioSingleIntraNodeSolver): unknown => {
  const candidates = portfolio.supervisedSolvers ?? []
  return {
    iterations: portfolio.iterations,
    maxIterations: portfolio.MAX_ITERATIONS,
    adaptiveSearchExpanded: portfolio.adaptiveSearchExpanded,
    negotiatedSearchStarted: portfolio.negotiatedSearchStarted,
    activeIndex: candidates.findIndex((entry) => entry.solver === portfolio.activeSubSolver),
    winnerIndex: candidates.findIndex((entry) => entry.solver === portfolio.winningSolver),
    solved: portfolio.solved, failed: portfolio.failed,
    dynamicExpansionWorkBudget: portfolio.stats.dynamicExpansionWorkBudget,
    adaptiveSearchExpandedAtIteration: portfolio.stats.adaptiveSearchExpandedAtIteration,
    candidateWorkAtExpansion: portfolio.stats.candidateWorkAtExpansion,
    bestProgressAtExpansion: portfolio.stats.bestProgressAtExpansion,
    candidates: candidates.map(({ solver, hyperParameters, g, h, f }) => ({
      hyperParameters, g, h, f,
      solverName: solver.getSolverName(),
      iterations: solver.iterations,
      maxIterations: solver.MAX_ITERATIONS,
      progress: solver.progress,
      solved: solver.solved,
      failed: solver.failed,
      error: solver.error,
    })),
  }
}
