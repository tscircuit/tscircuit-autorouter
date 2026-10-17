import type { GraphicsObject } from "graphics-debug"
import { CachableSolver, CacheProvider } from "lib/cache/types"
import type { AutoroutingDiagnostic } from "lib/types/diagnostics"

export type PendingEffect = {
  name: string
  promise: Promise<unknown>
}

export type SolverEventMap = {
  diagnostic: (diagnostic: AutoroutingDiagnostic) => void
  [event: string]: (...args: any[]) => void
}

export class BaseSolver {
  MAX_ITERATIONS = 1000
  solved = false
  failed = false
  iterations = 0
  progress = 0
  error: string | null = null
  diagnostics?: AutoroutingDiagnostic[]
  private _listeners?: { [K in keyof SolverEventMap]?: SolverEventMap[K][] }
  activeSubSolver?: BaseSolver | null
  failedSubSolvers?: BaseSolver[]
  timeToSolve?: number
  stats: Record<string, any> = {}
  pendingEffects?: PendingEffect[]

  /**
   * For cached solvers
   **/
  cacheHit?: boolean
  cacheKey?: string
  cacheToSolveSpaceTransform?: any
  getSolverName(): string {
    return this.constructor.name
  }

  /** DO NOT OVERRIDE! Override _step() instead */
  step() {
    if (this.solved) return
    if (this.failed) return
    this.iterations++
    try {
      this._step()
    } catch (e) {
      this.error = `${this.getSolverName()} error: ${e}`
      console.error(this.error)
      this.failed = true
      throw e
    }
    if (!this.solved && this.iterations > this.MAX_ITERATIONS) {
      this.tryFinalAcceptance()
    }
    if (!this.solved && this.iterations > this.MAX_ITERATIONS) {
      this.error = `${this.getSolverName()} ran out of iterations (MAX_ITERATIONS=${this.MAX_ITERATIONS})`
      this.failed = true
    }
    if ("computeProgress" in this) {
      // @ts-ignore
      this.progress = this.computeProgress() as number
    }
  }

  _step() {}

  getConstructorParams() {
    throw new Error("getConstructorParams not implemented")
  }

  on?: <K extends keyof SolverEventMap>(
    event: K,
    listener: SolverEventMap[K],
  ) => this = (event, listener) => {
    if (!this._listeners) {
      this._listeners = {}
    }
    if (!this._listeners[event]) {
      this._listeners[event] = []
    }
    this._listeners[event]?.push(listener)
    return this
  }

  off?: <K extends keyof SolverEventMap>(
    event: K,
    listener: SolverEventMap[K],
  ) => this = (event, listener) => {
    if (!this._listeners || !this._listeners[event]) return this
    this._listeners[event] = this._listeners[event]?.filter(
      (l) => l !== listener,
    )
    return this
  }

  emit?: (event: string, ...args: any[]) => void = (event, ...args) => {
    if (!this._listeners || !this._listeners[event]) return
    for (const listener of this._listeners[event] ?? []) {
      try {
        listener(...args)
      } catch (err) {
        console.error(`Error in solver event listener for ${event}:`, err)
      }
    }
  }

  emitDiagnostic?: (diagnostic: AutoroutingDiagnostic) => void = (
    diagnostic,
  ) => {
    if (!this.diagnostics) {
      this.diagnostics = []
    }
    this.diagnostics.push(diagnostic)
    this.emit?.("diagnostic", diagnostic)
  }

  getDiagnostics?: () => AutoroutingDiagnostic[] = () => {
    return this.diagnostics ?? []
  }

  solve() {
    const startTime = Date.now()
    while (!this.solved && !this.failed) {
      this.step()
    }
    const endTime = Date.now()
    this.timeToSolve = endTime - startTime
  }

  visualize(): GraphicsObject {
    return {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
  }

  /**
   * Called when the solver is about to fail, but we want to see if we have an
   * "acceptable" or "passable" solution. Mostly used for optimizers that
   * have an aggressive early stopping criterion.
   */
  tryFinalAcceptance() {}

  /**
   * A lightweight version of the visualize method that can be used to stream
   * progress
   */
  preview(): GraphicsObject {
    return {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }
  }
}
