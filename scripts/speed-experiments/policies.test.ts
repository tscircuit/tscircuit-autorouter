import { expect, test } from "bun:test"
import { BaseSolver } from "../../lib/solvers/BaseSolver"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { installPolicy, POLICY_NAMES } from "./policies"

class StubCandidate extends BaseSolver {
  solvedRoutes: unknown[] = []
  hyperParameters: Record<string, number> = {}
  MAX_ITERATIONS = 3_000_000
  override _step(): void {}
}

function createPortfolio(): PortfolioSingleIntraNodeSolver {
  return new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "policy-test",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      portPoints: [
        { connectionName: "a", x: -5, y: 0, z: 0 },
        { connectionName: "a", x: 5, y: 0, z: 0 },
      ],
    },
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    layerCount: 2,
    obstacles: [],
  })
}

function entryFor(
  solver: StubCandidate,
  hyperParameters: Record<string, number> = {},
  fitness = 0,
): NonNullable<PortfolioSingleIntraNodeSolver["supervisedSolvers"]>[number] {
  return {
    solver: solver as unknown as NonNullable<PortfolioSingleIntraNodeSolver["supervisedSolvers"]>[number]["solver"],
    hyperParameters,
    f: fitness,
    g: fitness,
    h: 0,
  }
}

test("experimental policies preserve termination, restrict effort, and restore prototypes", (): void => {
  const originalStep = PortfolioSingleIntraNodeSolver.prototype._step
  const originalSelect = PortfolioSingleIntraNodeSolver.prototype.getSupervisedSolverWithBestFitness

  for (const name of POLICY_NAMES) {
    const installed = installPolicy(name)
    try {
      expect(() => installPolicy("baseline")).toThrow("already installed")
      const portfolio = createPortfolio()
      const candidate = new StubCandidate()
      portfolio.supervisedSolvers = [entryFor(candidate)]

      if (name === "bounded-growth") {
        candidate.iterations = 1_999_900
        portfolio.step()
        expect(candidate.iterations).toBe(2_000_000)
        expect(portfolio.failed).toBe(true)
        expect(portfolio.solved).toBe(false)
        expect(portfolio.solvedRoutes).toHaveLength(0)
        expect(portfolio.error).toContain("aggregate work budget")
        expect(installed.events.at(-1)?.work).toBe(2_000_000)
      } else if (name === "stagnation-growth") {
        candidate.solvedRoutes = [{}]
        candidate.iterations = 999_900
        portfolio.iterations = 63
        portfolio.step()
        expect(portfolio.failed).toBe(false)
        candidate.iterations = 1_499_900
        portfolio.iterations = 127
        portfolio.step()
        expect(portfolio.failed).toBe(true)
        expect(portfolio.solved).toBe(false)
        expect(portfolio.error).toContain("500000 candidate iterations")
        expect(installed.events.at(-1)?.bestCompleted).toBe(1)
      } else if (name === "coarse-first") {
        const coarseCandidate = new StubCandidate()
        const coarseEntry = entryFor(coarseCandidate, {
          CELL_SIZE_FACTOR: 2,
          VIA_PENALTY_FACTOR_2: 10,
        }, 100)
        portfolio.supervisedSolvers.push(coarseEntry)
        expect(portfolio.getSupervisedSolverWithBestFitness()).toBe(coarseEntry)
        coarseCandidate.iterations = 50_000
        expect(portfolio.getSupervisedSolverWithBestFitness()?.solver).toBe(candidate as never)
        coarseCandidate.solved = true
        expect(portfolio.getSupervisedSolverWithBestFitness()).toBe(coarseEntry)
      } else if (name === "reduced-breadth") {
        const definitions = portfolio.getHyperParameterDefs()
        expect(definitions.find((definition) => definition.name === "orderings6")?.possibleValues).toHaveLength(2)
        expect(definitions.find((definition) => definition.name === "orderings50")?.possibleValues).toHaveLength(4)
        const runtime = portfolio as unknown as {
          addSupervisedCandidate: (parameters: Record<string, unknown>) => void
        }
        runtime.addSupervisedCandidate({ HIGH_DENSITY_A01: true, SHUFFLE_SEED: 2 })
        expect(portfolio.supervisedSolvers).toHaveLength(1)
        expect(installed.events.at(-1)?.type).toBe("candidate-pruned")
      } else {
        portfolio.step()
        expect(candidate.iterations).toBe(100)
        expect(portfolio.failed).toBe(false)
      }
    } finally {
      installed.restore()
      installed.restore()
    }
    expect(PortfolioSingleIntraNodeSolver.prototype._step).toBe(originalStep)
    expect(PortfolioSingleIntraNodeSolver.prototype.getSupervisedSolverWithBestFitness).toBe(originalSelect)
  }

  const scoped = installPolicy("bounded-growth", { shouldApply: () => false })
  try {
    const portfolio = createPortfolio()
    const candidate = new StubCandidate()
    candidate.iterations = 1_999_900
    portfolio.supervisedSolvers = [entryFor(candidate)]
    portfolio.step()
    expect(portfolio.failed).toBe(false)
    expect(portfolio.solved).toBe(false)
  } finally {
    scoped.restore()
  }
})
