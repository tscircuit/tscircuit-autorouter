import type { PortfolioSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { PortfolioSolverAdapter } from "./PortfolioSolverAdapter"
import type { GrowShrinkHighDensityIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { HighDensitySolver } from "../../solvers/HighDensitySolver/HighDensitySolver"

/** Keeps callback owners reachable only while their native orchestration runs. */
export class PortfolioCallbackScope {
  static current: PortfolioCallbackScope | undefined
  private nextKey = 0
  private readonly portfolios = new Map<number, PortfolioSolverAdapter>()
  private readonly growth = new Map<number, GrowShrinkHighDensityIntraNodeSolver>()
  private readonly boards = new Map<number, HighDensitySolver>()
  private synchronizing = false

  adopt(portfolio: PortfolioSingleIntraNodeSolver): number {
    const key = this.nextKey++
    const supervisor = portfolio.getPortfolioAdapter()
    this.portfolios.set(key, supervisor)
    return supervisor.shareForOrchestration(this, key)
  }

  get(key: number): PortfolioSolverAdapter {
    const supervisor = this.portfolios.get(key)
    if (!supervisor) throw new Error(`Unknown native portfolio callback owner ${key}`)
    return supervisor
  }

  release(key: number): void {
    const supervisor = this.portfolios.get(key)
    supervisor?.finishSolverRun()
    this.portfolios.delete(key)
  }

  registerGrowth(solver: GrowShrinkHighDensityIntraNodeSolver): number {
    const key = this.nextKey++
    this.growth.set(key, solver)
    return key
  }

  releaseGrowth(key: number): void {
    this.growth.delete(key)
  }

  runGrowth<T>(key: number, solver: GrowShrinkHighDensityIntraNodeSolver, fn: () => T): T {
    const retained = this.growth.has(key)
    this.growth.set(key, solver)
    try { return this.run(fn) }
    finally { if (!retained) this.growth.delete(key) }
  }

  getGrowth(key: number): GrowShrinkHighDensityIntraNodeSolver {
    const solver = this.growth.get(key)
    if (!solver) throw new Error(`Unknown native growth callback owner ${key}`)
    return solver
  }

  registerBoard(solver: HighDensitySolver): number {
    const key = this.nextKey++
    this.boards.set(key, solver)
    return key
  }

  getBoard(key: number): HighDensitySolver {
    const solver = this.boards.get(key)
    if (!solver) throw new Error(`Unknown native board callback owner ${key}`)
    return solver
  }

  run<T>(fn: () => T): T {
    const previous = PortfolioCallbackScope.current
    if (previous === this) return fn()
    for (const supervisor of this.portfolios.values()) supervisor.prepareSolverRun()
    for (const solver of this.growth.values()) solver.prepareSolverRun()
    PortfolioCallbackScope.current = this
    try { return fn() }
    finally {
      PortfolioCallbackScope.current = previous
      for (const supervisor of this.portfolios.values()) supervisor.finishSolverRun()
      for (const solver of this.growth.values()) solver.finishSolverRun()
    }
  }

  sync(): void {
    if (this.synchronizing || PortfolioCallbackScope.current === this) return
    this.synchronizing = true
    try {
      for (const supervisor of this.portfolios.values()) supervisor.syncObservedState()
      for (const solver of this.growth.values()) solver.syncObservedState()
    } finally { this.synchronizing = false }
  }
}
