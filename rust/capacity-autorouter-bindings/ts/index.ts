import { BaseSolver } from "@tscircuit/solver-utils"
import type { HighDensityVariant, HighDensityProps } from "./types.js"
export type * from "./types.js"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { initializeAutorouterBindings } from "lib/bindings/initializeAutorouterBindings"
import * as bindings from "../pkg/capacity_autorouter_bindings.js"

export class HighDensitySolverAdapter<V extends HighDensityVariant = HighDensityVariant> extends BaseSolver {
  private binding: bindings.HighDensityCandidateSolver | undefined
  private solvedSegmentCount = 0
  private readonly endpointIndexKey: string

  constructor(readonly variant: V, private readonly props: HighDensityProps[V]) {
    super()
    initializeAutorouterBindings()
    this.MAX_ITERATIONS = 100e6
    const { initialPenaltyFn, ...input } = props
    let endpointIndexKey = "__wasmEndpointIndex"
    while (props.nodeWithPortPoints.portPoints.some((point) => Object.hasOwn(point, endpointIndexKey))) {
      endpointIndexKey += "_"
    }
    this.endpointIndexKey = endpointIndexKey
    const portPoints = props.nodeWithPortPoints.portPoints.map((point, index) => ({
      connectionName: point.connectionName,
      rootConnectionName: point.rootConnectionName,
      portPointId: point.portPointId,
      prevPortPointId: point.prevPortPointId,
      nextPortPointId: point.nextPortPointId,
      x: point.x, y: point.y, z: point.z,
      [endpointIndexKey]: index,
    }))
    this.binding = new bindings.HighDensityCandidateSolver(variant, {
      ...input, nodeWithPortPoints: { ...input.nodeWithPortPoints, portPoints },
    }, initialPenaltyFn)
  }

  override getSolverName(): string {
    return this.variant === "a01" ? "HighDensitySolverA01" : "HighDensitySolverA03"
  }

  override _setup(): void {
    if (!this.binding) throw new Error("High-density WASM solver has been disposed")
    const status = this.binding.setup(this.MAX_ITERATIONS)
    this.MAX_ITERATIONS = status.maxIterations
    this.solved = status.solved
    this.failed = status.failed
    this.error = status.error
  }

  override _step(): void {
    if (!this.binding) throw new Error("High-density WASM solver has been disposed")
    const status = this.binding.step(this.iterations, this.MAX_ITERATIONS)
    this.solvedSegmentCount = Math.floor(status / 4)
    this.solved = status % 2 === 1
    this.failed = Math.floor(status / 2) % 2 === 1
    if (this.failed) this.error = this.binding.error() ?? null
  }

  shareForPortfolio(): number {
    if (!this.binding) throw new Error("High-density WASM solver has been disposed")
    return this.binding.shareForPortfolio()
  }

  syncPortfolioSegmentCount(count: number): void {
    this.solvedSegmentCount = count
  }

  getSolvedSegmentCount(): number {
    return this.solvedSegmentCount
  }

  override getConstructorParams(): [V, HighDensityProps[V]] {
    return [this.variant, this.props]
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    if (!this.binding) throw new Error("High-density WASM solver has been disposed")
    const routes = this.binding.getOutput()
    // TS returns spreads of the original endpoint objects. Preserve their own
    // undefined properties and metadata that JSON values cannot represent.
    for (const route of routes) {
      route.route = route.route.map((point) => {
        if (!Object.hasOwn(point, this.endpointIndexKey)) return point
        const index = (point as unknown as Record<string, unknown>)[this.endpointIndexKey]
        if (typeof index !== "number" || !Number.isInteger(index)) {
          throw new Error("Invalid WASM route endpoint index")
        }
        const original = this.props.nodeWithPortPoints.portPoints[index]
        if (!original) throw new Error("WASM route endpoint index is out of bounds")
        return { ...original }
      })
    }
    return routes
  }

  override visualize(): GraphicsObject {
    if (!this.binding) throw new Error("High-density WASM solver has been disposed")
    return this.binding.visualize()
  }

  dispose(): void {
    this.binding?.free()
    this.binding = undefined
  }
}
