import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

function createNode(): NodeWithPortPoints {
  return {
    capacityMeshNodeId: "distinct-a01-orders",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: ["A", "B", "C", "D"].flatMap((connectionName, index) => [
      { connectionName, x: -1, y: -0.75 + index * 0.5, z: 0 },
      { connectionName, x: 1, y: -0.75 + index * 0.5, z: 0 },
    ]),
  }
}

function expand(portfolio: PortfolioSingleIntraNodeSolver): void {
  ;(portfolio as unknown as { expandAdaptiveSearch(): void }).expandAdaptiveSearch()
}

function getA01Solvers(
  portfolio: PortfolioSingleIntraNodeSolver,
): HighDensitySolverA01[] {
  return portfolio.supervisedSolvers!
    .map(({ solver }) => solver)
    .filter(
      (solver): solver is typeof solver & HighDensitySolverA01 =>
        solver instanceof HighDensitySolverA01,
    )
}

test("adaptive A01 keeps distinct initial orders after the first queue mutates", (): void => {
  const setupSeeds: number[] = []
  const originalSetup = HighDensitySolverA01.prototype._setup
  HighDensitySolverA01.prototype._setup = function (): void {
    originalSetup.call(this)
    setupSeeds.push(this.hyperParameters.shuffleSeed)
  }
  try {
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: createNode(),
      traceWidth: 0.1,
      viaDiameter: 0.3,
      deduplicateA01InitialOrders: true,
    })
    portfolio.initializeSolvers()
    const first = getA01Solvers(portfolio)[0]!
    expect(first.unsolvedConnections).toHaveLength(4)
    first.unsolvedConnections.pop()
    first.iterations = first.MAX_ITERATIONS
    first.failed = true
    expand(portfolio)
    expect(setupSeeds).toEqual([0, 1, 2, 3, 4, 5])
    expect(
      getA01Solvers(portfolio).map((solver) => solver.hyperParameters.shuffleSeed),
    ).toEqual([0, 1, 2, 5])
    expect(portfolio.stats.candidateWorkAtExpansion).toBe(first.iterations)

    // A custom factory retains its original candidates and scheduling budget.
    const control = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: createNode(),
      traceWidth: 0.1,
      viaDiameter: 0.3,
      deduplicateA01InitialOrders: true,
    })
    const generateSolver = control.generateSolver
    control.generateSolver = function (hyperParameters) {
      return generateSolver.call(this, hyperParameters)
    }
    control.initializeSolvers()
    const controlFirst = getA01Solvers(control)[0]!
    controlFirst.unsolvedConnections.pop()
    controlFirst.iterations = controlFirst.MAX_ITERATIONS
    controlFirst.failed = true
    expand(control)
    expect(getA01Solvers(control)).toHaveLength(6)
    const duplicateWork = getA01Solvers(control)
      .filter((solver) => [3, 4].includes(solver.hyperParameters.shuffleSeed))
      .reduce(
        (work, solver) =>
          work + Math.ceil((solver.MAX_ITERATIONS + 1) / control.MIN_SUBSTEPS),
        0,
      )
    expect(control.MAX_ITERATIONS - portfolio.MAX_ITERATIONS).toBe(duplicateWork)
    expect(control.stats.candidateWorkAtExpansion).toBe(first.iterations)

    // Reinitialization captures the new problem instead of using old signatures.
    portfolio.nodeWithPortPoints.portPoints[0]!.x += 0.001
    portfolio.initializeSolvers()
    const reinitializedOrders = (
      portfolio as unknown as { initialA01Orders: Set<string> }
    ).initialA01Orders
    expect(reinitializedOrders.size).toBe(1)
    expect(
      (portfolio as unknown as { nextInitialA01PointId: number })
        .nextInitialA01PointId,
    ).toBe(8)

    // Shared connection IDs and equal raw coordinates still identify distinct
    // endpoints, so their different permutations must remain separate attempts.
    const aliases = createNode()
    aliases.portPoints = [
      [-1, 0],
      [-0.5, 0],
      [-1, 0],
      [0.25, 0.25],
      [0.75, -0.25],
      [1, 0.75],
    ].map(([x, y]) => ({ connectionName: "A", x: x!, y: y!, z: 0 }))
    const aliasPortfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: aliases,
      traceWidth: 0.1,
      deduplicateA01InitialOrders: true,
    })
    aliasPortfolio.initializeSolvers()
    const aliasFirst = getA01Solvers(aliasPortfolio)[0]!
    expect(aliasFirst.unsolvedConnections).toHaveLength(4)
    expect(
      new Set(aliasFirst.unsolvedConnections.map((segment) => segment.connId)).size,
    ).toBe(1)
    const pointIds = (
      aliasPortfolio as unknown as { initialA01PointIds: WeakMap<object, number> }
    ).initialA01PointIds
    expect(pointIds.has(aliases.portPoints[0]!)).toBe(true)
    expect(pointIds.has(aliases.portPoints[2]!)).toBe(true)
    expect(pointIds.get(aliases.portPoints[0]!)).not.toBe(
      pointIds.get(aliases.portPoints[2]!),
    )
    expand(aliasPortfolio)
    expect(
      getA01Solvers(aliasPortfolio).map(
        (solver) => solver.hyperParameters.shuffleSeed,
      ),
    ).toEqual([0, 1, 2, 5])

    // Accessor-backed endpoints retain all attempts without extra reads.
    const accessorNode = createNode()
    let coordinateReads = 0
    Object.defineProperty(accessorNode.portPoints[0], "x", {
      get(): number {
        coordinateReads++
        return -1
      },
      enumerable: true,
    })
    const accessorPortfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: accessorNode,
      traceWidth: 0.1,
    })
    accessorPortfolio.initializeSolvers()
    const readsBeforeFingerprint = coordinateReads
    const accessorFirst = getA01Solvers(accessorPortfolio)[0]!
    expect(
      (
        accessorPortfolio as unknown as {
          getInitialA01Order(solver: unknown): string | null
        }
      ).getInitialA01Order(accessorFirst),
    ).toBeNull()
    expect(coordinateReads).toBe(readsBeforeFingerprint)
    expand(accessorPortfolio)
    expect(getA01Solvers(accessorPortfolio)).toHaveLength(6)

    const originalNode = createNode()
    const growShrink = new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints: originalNode,
      traceWidth: 0.1,
    })
    ;(
      growShrink as unknown as { createActiveSubSolver(): void }
    ).createActiveSubSolver()
    const ownedPortfolio = growShrink.activeSubSolver!
    expect(ownedPortfolio.nodeWithPortPoints.portPoints[0]).not.toBe(
      originalNode.portPoints[0],
    )
    ownedPortfolio.initializeSolvers()
    expand(ownedPortfolio)
    expect(getA01Solvers(ownedPortfolio)).toHaveLength(4)
  } finally {
    HighDensitySolverA01.prototype._setup = originalSetup
  }
})
