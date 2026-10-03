import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

class WorkTrackingPortfolio extends PortfolioSingleIntraNodeSolver {
  override generateSolver(
    hyperParameters: Record<string, unknown>,
  ): IntraNodeRouteSolver {
    const solver = super.generateSolver(hyperParameters)
    solver.step = (): void => {
      if (solver.solved || solver.failed) return
      solver.iterations++
      solver.progress = (solver.iterations % 3000) / 4000
      if (solver instanceof HighDensitySolverA13) {
        solver.routingIterations += 1000
      }
      // Exercise a candidate that revises its own limit after initialization.
      if (solver.iterations === 500) solver.MAX_ITERATIONS -= 500
      if (solver.iterations > solver.MAX_ITERATIONS) solver.failed = true
    }
    return solver
  }
}

test("tracked candidate work retains scanning expansion policy and scheduling", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "tracked-candidate-work",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "A", x: -1, y: -1, z: 0 },
      { connectionName: "A", x: 1, y: 1, z: 0 },
      { connectionName: "B", x: -1, y: 1, z: 0 },
      { connectionName: "B", x: 1, y: -1, z: 0 },
    ],
  }
  const params = { nodeWithPortPoints: node, enableNegotiatedSearch: true }
  const tracked = new WorkTrackingPortfolio(params)
  const scanning = new WorkTrackingPortfolio(params)
  ;(scanning as any).shouldExpandPortfolio = (): boolean => {
    if (scanning.adaptiveSearchExpanded) return false
    const candidates = scanning.supervisedSolvers!.filter(
      ({ solver }) => !(solver instanceof HighDensitySolverA13),
    )
    const budget = Math.max(
      1,
      ...candidates.map(({ solver }) => solver.MAX_ITERATIONS),
    )
    scanning.stats.dynamicExpansionWorkBudget = budget
    return (
      candidates.reduce((total, { solver }) => total + solver.iterations, 0) >=
      budget
    )
  }
  const observedSchedule: Array<{ name: string; iterations: number }> = []
  const scanningSchedule: Array<{ name: string; iterations: number }> = []
  for (let step = 0; step < 3000; step++) {
    tracked.step()
    scanning.step()
    observedSchedule.push({
      name: tracked.activeSubSolver!.getSolverName(),
      iterations: tracked.activeSubSolver!.iterations,
    })
    scanningSchedule.push({
      name: scanning.activeSubSolver!.getSolverName(),
      iterations: scanning.activeSubSolver!.iterations,
    })
    if (tracked.adaptiveSearchExpanded && scanning.adaptiveSearchExpanded) break
  }
  expect(tracked.adaptiveSearchExpanded).toBe(true)
  expect(scanning.adaptiveSearchExpanded).toBe(true)
  expect(observedSchedule).toEqual(scanningSchedule)
  expect(tracked.stats).toEqual(scanning.stats)
  expect(tracked.MAX_ITERATIONS).toBe(scanning.MAX_ITERATIONS)
  expect(
    tracked.supervisedSolvers!.map(({ solver }) => [
      solver.iterations,
      solver.MAX_ITERATIONS,
      solver.failed,
    ]),
  ).toEqual(
    scanning.supervisedSolvers!.map(({ solver }) => [
      solver.iterations,
      solver.MAX_ITERATIONS,
      solver.failed,
    ]),
  )
})
