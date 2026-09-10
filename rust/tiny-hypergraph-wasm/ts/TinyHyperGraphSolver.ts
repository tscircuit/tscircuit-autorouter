import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import { RustTinyHyperGraphSolver } from "../pkg/tiny_hypergraph_wasm.js"
import { assertTinyHypergraphWasmInitialized } from "./initTinyHypergraphWasm.js"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphRoutingSnapshot,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphSolution,
  TinyHyperGraphSolverConfiguration,
  TinyHyperGraphStats,
  TinyHyperGraphStatus,
  TinyHyperGraphTopology,
} from "./types.js"

type WasmStatus = Omit<TinyHyperGraphStatus, "error"> & { error: string | undefined }

/** Synchronous solver methods after one-time WASM initialization. */
export class TinyHyperGraphSolver {
  private handle: RustTinyHyperGraphSolver | undefined

  solved = false
  failed = false
  error: string | null = null
  iterations = 0
  pendingRouteCount = 0
  ripCount = 0

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
    configuration?: TinyHyperGraphSolverConfiguration,
  ) {
    assertTinyHypergraphWasmInitialized()
    this.handle = new RustTinyHyperGraphSolver(topology, problem, options, configuration)
    this.updateStatus(this.handle.getStatus() as WasmStatus)
  }

  private getHandleOrThrow(): RustTinyHyperGraphSolver {
    if (!this.handle) {
      throw new Error("TinyHyperGraphSolver has been disposed")
    }
    return this.handle
  }

  private updateStatus(status: WasmStatus): TinyHyperGraphStatus {
    this.solved = status.solved
    this.failed = status.failed
    this.error = status.error ?? null
    this.iterations = status.iterations
    this.pendingRouteCount = status.pendingRouteCount
    this.ripCount = status.ripCount
    return { ...status, error: this.error }
  }

  step(): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().step() as WasmStatus
    return this.updateStatus(status)
  }

  stepMany(maxSteps: number): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().stepMany(maxSteps) as WasmStatus
    return this.updateStatus(status)
  }

  solve(): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().solve() as WasmStatus
    return this.updateStatus(status)
  }

  getStatus(): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().getStatus() as WasmStatus
    return this.updateStatus(status)
  }

  getRoutingSnapshot(): TinyHyperGraphRoutingSnapshot {
    return this.getHandleOrThrow().getRoutingSnapshot() as TinyHyperGraphRoutingSnapshot
  }

  getStats(): TinyHyperGraphStats {
    return this.getHandleOrThrow().getStats() as TinyHyperGraphStats
  }

  getOutput(): SerializedHyperGraph {
    return this.getHandleOrThrow().getOutput() as SerializedHyperGraph
  }

  /** Rebuilds a complete solved state in route order, validating each route path. */
  replaySolution(solution: TinyHyperGraphSolution): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().replaySolution(solution) as WasmStatus
    return this.updateStatus(status)
  }

  visualize(): GraphicsObject {
    return this.getHandleOrThrow().visualize() as GraphicsObject
  }

  preview(): GraphicsObject {
    return this.visualize()
  }

  /** Idempotent disposal; status fields retain their last observed values. */
  dispose(): void {
    if (this.handle) {
      this.handle.free()
      this.handle = undefined
    }
  }
}
