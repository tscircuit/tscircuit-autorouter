import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class ExpansionWorkPortfolio extends PortfolioSingleIntraNodeSolver {
  override generateSolver(hyperParameters: Record<string, unknown>): IntraNodeRouteSolver {
    const solver = super.generateSolver(hyperParameters)
    solver.step = (): void => {
      if (solver.solved || solver.failed) return
      solver.iterations++
      solver.progress = (solver.iterations % 3000) / 4000
      if (solver instanceof HighDensitySolverA13) solver.routingIterations += 1000
      if (solver.iterations === 500) solver.MAX_ITERATIONS -= 500
      if (solver.iterations > solver.MAX_ITERATIONS) solver.failed = true
    }
    return solver
  }
}

test("adaptive expansion sees the same empty native progress and iteration budgets before materialization", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "deferred-expansion", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1], portPoints: [
    { connectionName: "A", x: -1, y: -1, z: 0 }, { connectionName: "A", x: 1, y: 1, z: 0 },
    { connectionName: "B", x: -1, y: 1, z: 0 }, { connectionName: "B", x: 1, y: -1, z: 0 },
  ] }
  const eager = new ExpansionWorkPortfolio({ nodeWithPortPoints: node, enableNegotiatedSearch: true, deferNativeGridMaterialization: false })
  const deferred = new ExpansionWorkPortfolio({ nodeWithPortPoints: node, enableNegotiatedSearch: true })
  for (let step = 0; step < 3000; step++) {
    eager.step()
    deferred.step()
    expect(deferred.activeSubSolver?.getSolverName()).toBe(eager.activeSubSolver?.getSolverName())
    expect(deferred.activeSubSolver?.iterations).toBe(eager.activeSubSolver?.iterations)
    expect(deferred.stats).toEqual(eager.stats)
    expect(deferred.MAX_ITERATIONS).toBe(eager.MAX_ITERATIONS)
    if (eager.adaptiveSearchExpanded && deferred.adaptiveSearchExpanded) break
  }
  expect(eager.adaptiveSearchExpanded).toBe(true)
  expect(deferred.adaptiveSearchExpanded).toBe(true)
  expect(deferred.nativeGridSetupDiagnostics.deferredCandidateCount).toBe(7)
  expect(deferred.nativeGridSetupDiagnostics.materializedCandidateCount).toBe(0)
  expect(deferred.supervisedSolvers!.map(({ solver, f, g, h }) => [solver.getSolverName(), solver.iterations, solver.MAX_ITERATIONS, solver.failed, f, g, h])).toEqual(eager.supervisedSolvers!.map(({ solver, f, g, h }) => [solver.getSolverName(), solver.iterations, solver.MAX_ITERATIONS, solver.failed, f, g, h]))
})
