import { SolverRuntime } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  Pipeline9JointDrcRepairSolver,
  type Pipeline9JointDrcRepairSolverParams,
} from "./Pipeline9JointDrcRepairSolver"

export type Pipeline9SpeculativeExactRepairInput = {
  params: Omit<Pipeline9JointDrcRepairSolverParams, "connMap">
  connectivityNetMap: Record<string, string[]>
  connectivityIdToNetMap: Record<string, string>
  projectedRoutes?: HighDensityRoute[]
}

export type Pipeline9SpeculativeExactRepairOutput = {
  routes: HighDensityRoute[]
  stats: Record<string, unknown>
  iterations: number
  telemetry: ReturnType<Pipeline9JointDrcRepairSolver["getSpeculativeDrcTelemetry"]>
}

export const restoreSpeculativeConnectivityMap = (
  netMap: Record<string, string[]>,
  idToNetMap: Record<string, string>,
): ConnectivityMap => {
  const connMap = new ConnectivityMap(netMap)
  // addConnections can retain aliases in netMap after merging networks;
  // its authoritative ID mapping cannot be reconstructed from those aliases.
  connMap.idToNetMap = idToNetMap
  return connMap
}

/** Prepare the same DRC context and evaluate the independent exact candidate. */
export class Pipeline9SpeculativeExactRepairSolver extends BaseSolver {
  static readonly solverName = "Pipeline9SpeculativeExactRepairSolver"
  private output?: Pipeline9SpeculativeExactRepairOutput

  constructor(private readonly input: Pipeline9SpeculativeExactRepairInput) {
    super()
  }

  override _step(): void {
    const owner = new Pipeline9JointDrcRepairSolver({
      ...this.input.params,
      connMap: restoreSpeculativeConnectivityMap(
        this.input.connectivityNetMap,
        this.input.connectivityIdToNetMap,
      ),
    })
    const before = owner.getSpeculativeDrcTelemetry()
    const solver = owner.createSpeculativeExactSolver(this.input.projectedRoutes)
    solver.solve()
    if (solver.failed) {
      throw new Error(`Pipeline9 speculative exact repair failed: ${solver.error}`)
    }
    this.output = {
      routes: solver.getOutput(),
      stats: solver.stats,
      iterations: solver.iterations,
      telemetry: owner.getSpeculativeDrcTelemetry(before),
    }
    this.solved = true
  }

  getOutput(): Pipeline9SpeculativeExactRepairOutput {
    if (!this.output) throw new Error("Speculative exact repair is not complete")
    return this.output
  }
}

SolverRuntime.registerSolver(Pipeline9SpeculativeExactRepairSolver)
