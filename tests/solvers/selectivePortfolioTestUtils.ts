import { BaseSolver } from "lib/solvers/BaseSolver"
import type { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityIntraNodeRoute, NodeWithPortPoints } from "lib/types/high-density-types"

type FakeWorkload = {
  clock: { now: number }
  millisecondsPerStep: number
  winningSeed?: number
  stepsToWin?: number
  fastWinner?: boolean
  iterationLimit?: number
  clockSource?: "cpu" | "elapsed"
}

export const selectiveTestNode: NodeWithPortPoints = {
  capacityMeshNodeId: "selective-scheduler",
  center: { x: 0, y: 0 },
  width: 4,
  height: 4,
  availableZ: [0, 1],
  portPoints: [
    { connectionName: "a", x: -2, y: 0, z: 0 },
    { connectionName: "a", x: 2, y: 0, z: 0 },
  ],
}

class SimulatedRoutingCandidate extends BaseSolver {
  solvedRoutes: HighDensityIntraNodeRoute[] = [{
    connectionName: "a",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }],
    vias: [],
  }]

  constructor(private readonly workload: FakeWorkload, private readonly winner: boolean) {
    super()
    this.MAX_ITERATIONS = workload.iterationLimit ?? 1_000_000
  }

  override _step(): void {
    this.workload.clock.now += this.workload.millisecondsPerStep
    this.progress = 0.95
    if (this.winner && this.iterations >= (this.workload.stepsToWin ?? 1)) {
      this.solved = true
    }
  }
}

export class SimulatedSelectivePortfolio extends PortfolioSingleIntraNodeSolver {
  readonly constructed: Array<Record<string, any>> = []

  constructor(private readonly workload: FakeWorkload) {
    super({ nodeWithPortPoints: selectiveTestNode, selectivePortfolio: true, selectivePortfolioTiming: workload.clockSource ?? "elapsed" })
  }

  override getCombinationDefs(): string[][] {
    return [["simulated"]]
  }

  override getHyperParameterDefs(): Array<{ name: string; possibleValues: Array<Record<string, any>> }> {
    return [{ name: "simulated", possibleValues: [
      { THROUGH_OBSTACLE: true },
      { HIGH_DENSITY_A01: true, SHUFFLE_SEED: 0 },
      { HIGH_DENSITY_A03: true },
    ] }]
  }

  override generateSolver(hyperParameters: Record<string, any>): IntraNodeRouteSolver {
    this.constructed.push(hyperParameters)
    const winner = (this.workload.fastWinner && hyperParameters.THROUGH_OBSTACLE) ||
      (hyperParameters.HIGH_DENSITY_A01 && hyperParameters.SHUFFLE_SEED === this.workload.winningSeed)
    return new SimulatedRoutingCandidate(this.workload, Boolean(winner)) as unknown as IntraNodeRouteSolver
  }
}
