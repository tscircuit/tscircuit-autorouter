import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import * as bindings from "../pkg/tiny_hypergraph_bindings.js"
import {
  assertTinyHypergraphBindingsInitialized,
  getTinyHypergraphMemory,
} from "./loadTinyHypergraphBindings.js"
import { encodeJsonInput, decodeUndefinedJsonOutput } from "./jsonWire.js"
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

type SolverStatus = bindings.SolverStatus

/** Synchronous solver methods after one-time WASM initialization. */
export class TinyHyperGraphSolver {
  private handle: bindings.TinyHyperGraphSolver | undefined
  private readonly wasmMemory: WebAssembly.Memory
  private readonly stepStatusPointer: number
  private stepStatus: Uint32Array

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
    assertTinyHypergraphBindingsInitialized()
    this.handle = new bindings.TinyHyperGraphSolver(
      encodeJsonInput(topology),
      encodeJsonInput(problem),
      encodeJsonInput(options ?? null),
      encodeJsonInput(configuration ?? null),
    )
    this.wasmMemory = getTinyHypergraphMemory()
    this.stepStatusPointer = this.handle.stepStatusPointer()
    this.stepStatus = new Uint32Array(
      this.wasmMemory.buffer,
      this.stepStatusPointer,
      3,
    )
    this.updateStatus(this.handle.getStatus())
  }

  private getHandleOrThrow(): bindings.TinyHyperGraphSolver {
    if (!this.handle) {
      throw new Error("TinyHyperGraphSolver has been disposed")
    }
    return this.handle
  }

  private updateStatus(status: SolverStatus): TinyHyperGraphStatus {
    this.solved = status.solved
    this.failed = status.failed
    this.error = status.error ?? null
    this.iterations = status.iterations
    this.pendingRouteCount = status.pendingRouteCount
    this.ripCount = status.ripCount
    return { ...status, error: this.error }
  }

  step(): TinyHyperGraphStatus {
    const handle = this.getHandleOrThrow()
    const code = handle.stepCompact()
    this.iterations = Math.floor(code / 8)
    const flags = code % 8
    this.solved = (flags & 1) !== 0
    this.failed = (flags & 2) !== 0
    this.error = (flags & 4) !== 0 ? handle.currentError()! : null
    if (this.stepStatus.buffer !== this.wasmMemory.buffer) {
      this.stepStatus = new Uint32Array(
        this.wasmMemory.buffer,
        this.stepStatusPointer,
        3,
      )
    }
    this.pendingRouteCount = this.stepStatus[0]!
    this.ripCount = this.stepStatus[1]!
    return {
      solved: this.solved,
      failed: this.failed,
      error: this.error,
      iterations: this.iterations,
      pendingRouteCount: this.pendingRouteCount,
      ripCount: this.ripCount,
    }
  }

  stepMany(maxSteps: number): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().stepMany(maxSteps)
    return this.updateStatus(status)
  }

  solve(): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().solve()
    return this.updateStatus(status)
  }

  getStatus(): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().getStatus()
    return this.updateStatus(status)
  }

  resetRoutingStateForRerip(): void {
    this.getHandleOrThrow().resetRoutingStateForRerip()
  }

  getRoutingSnapshot(): TinyHyperGraphRoutingSnapshot {
    return decodeUndefinedJsonOutput(
      this.getHandleOrThrow().getRoutingSnapshot(),
    )
  }

  getMaxRegionCost(): number {
    return this.getHandleOrThrow().getMaxRegionCost()
  }

  getStatsRevision(): number {
    this.getHandleOrThrow()
    if (this.stepStatus.buffer !== this.wasmMemory.buffer) {
      this.stepStatus = new Uint32Array(
        this.wasmMemory.buffer,
        this.stepStatusPointer,
        3,
      )
    }
    return this.stepStatus[2]!
  }

  getStats(): TinyHyperGraphStats {
    return decodeUndefinedJsonOutput(this.getHandleOrThrow().getStats())
  }

  getOutput(): SerializedHyperGraph {
    return decodeUndefinedJsonOutput(this.getHandleOrThrow().getOutput())
  }

  /** Rebuilds a complete solved state in route order, validating each route path. */
  replaySolution(solution: TinyHyperGraphSolution): TinyHyperGraphStatus {
    const status = this.getHandleOrThrow().replaySolution(
      encodeJsonInput(solution),
    )
    return this.updateStatus(status)
  }

  visualize(): GraphicsObject {
    return decodeUndefinedJsonOutput(this.getHandleOrThrow().visualize())
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
