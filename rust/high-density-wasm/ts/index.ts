import { BaseSolver } from "@tscircuit/solver-utils"
import type { HighDensitySolverA01, HighDensitySolverA03, HighDensityIntraNodeRoute } from "@tscircuit/high-density-a01"
import type { GraphicsObject } from "graphics-debug"
import initialize, { HighDensitySolver as RawHighDensitySolver } from "../pkg/high_density_wasm.js"

export type HighDensityVariant = "a01" | "a03"
export type HighDensityProps = {
  a01: ConstructorParameters<typeof HighDensitySolverA01>[0]
  a03: ConstructorParameters<typeof HighDensitySolverA03>[0]
}
export type HighDensityWasmInput = Parameters<typeof initialize>[0]

let initialization: Promise<void> | undefined

export async function initializeHighDensityWasm(input?: HighDensityWasmInput): Promise<void> {
  if (!initialization) {
    initialization = initialize(input).then(() => undefined).catch((error: unknown) => {
      initialization = undefined
      throw error
    })
  }
  await initialization
}

export class WasmHighDensitySolver<V extends HighDensityVariant = HighDensityVariant> extends BaseSolver {
  private raw: RawHighDensitySolver | undefined
  private solvedSegmentCount = 0
  private readonly endpointIndexKey: string

  constructor(readonly variant: V, private readonly props: HighDensityProps[V]) {
    super()
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
    this.raw = new RawHighDensitySolver(variant, {
      ...input, nodeWithPortPoints: { ...input.nodeWithPortPoints, portPoints },
    }, initialPenaltyFn)
  }

  override getSolverName(): string {
    return this.variant === "a01" ? "HighDensitySolverA01" : "HighDensitySolverA03"
  }

  override _setup(): void {
    if (!this.raw) throw new Error("High-density WASM solver has been disposed")
    const status = this.raw.setup(this.MAX_ITERATIONS) as {
      maxIterations: number; solved: boolean; failed: boolean; error: string | null
    }
    this.MAX_ITERATIONS = status.maxIterations
    this.solved = status.solved
    this.failed = status.failed
    this.error = status.error
  }

  override _step(): void {
    if (!this.raw) throw new Error("High-density WASM solver has been disposed")
    const status = this.raw.step(this.iterations, this.MAX_ITERATIONS)
    this.solvedSegmentCount = Math.floor(status / 4)
    this.solved = status % 2 === 1
    this.failed = Math.floor(status / 2) % 2 === 1
    if (this.failed) this.error = this.raw.error() ?? null
  }

  getSolvedSegmentCount(): number {
    return this.solvedSegmentCount
  }

  override getConstructorParams(): [V, HighDensityProps[V]] {
    return [this.variant, this.props]
  }

  override getOutput(): HighDensityIntraNodeRoute[] {
    if (!this.raw) throw new Error("High-density WASM solver has been disposed")
    const routes = this.raw.getOutput() as HighDensityIntraNodeRoute[]
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
    if (!this.raw) throw new Error("High-density WASM solver has been disposed")
    return this.raw.visualize() as GraphicsObject
  }

  dispose(): void {
    this.raw?.free()
    this.raw = undefined
  }
}
