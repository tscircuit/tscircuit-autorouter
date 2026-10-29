import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"

type Params = {
  nodeWithPortPoints: NodeWithPortPoints
  coordinateScale: number
  maxSearchIterations: number
  traceWidth: number
  viaDiameter: number
  traceMargin: number
  effort: number
  shuffleSeed: number
  connMap?: ConnectivityMap
}

/** Use the existing typed, multiresolution grid for enlarged routing retries. */
export class ResizedHighDensityGridSolver extends HighDensitySolverA03 {
  private gridInitialized = false

  constructor(readonly params: Params) {
    super({
      nodeWithPortPoints: params.nodeWithPortPoints,
      highResolutionCellSize: 0.1,
      highResolutionCellThickness: 8,
      lowResolutionCellSize: 0.4,
      traceThickness: params.traceWidth,
      viaDiameter: params.viaDiameter,
      viaMinDistFromBorder: params.viaDiameter / 2,
      traceMargin: params.traceMargin,
      effort: params.effort,
      hyperParameters: { shuffleSeed: params.shuffleSeed },
    })
    this.MAX_ITERATIONS = params.maxSearchIterations
    this.stats.coordinateScale = params.coordinateScale
    const ports = params.nodeWithPortPoints.portPoints
    for (let i = 0; i < ports.length; i++) {
      for (let j = i + 1; j < ports.length; j++) {
        const a = ports[i]!
        const b = ports[j]!
        if (
          a.z !== b.z ||
          (a.rootConnectionName ?? a.connectionName) ===
            (b.rootConnectionName ?? b.connectionName) ||
          params.connMap?.areIdsConnected(a.connectionName, b.connectionName)
        ) {
          continue
        }
        if (
          Math.hypot(a.x - b.x, a.y - b.y) <
          params.traceWidth + params.traceMargin - 1e-6
        ) {
          this.failed = true
          this.error =
            "Resized grid terminals violate the requested copper clearance"
          return
        }
      }
    }
  }

  override getSolverName(): string {
    return "ResizedHighDensityGridSolver"
  }

  override get solvedConnectionsMap(): HighDensitySolverA03["solvedConnectionsMap"] {
    return this.gridInitialized ? super.solvedConnectionsMap : new Map()
  }

  override getConstructorParams(): [
    ConstructorParameters<typeof HighDensitySolverA03>[0] & Params,
  ] {
    return [{ ...super.getConstructorParams()[0], ...this.params }]
  }

  override _setup(): void {
    if (this.failed) return
    super._setup()
    this.gridInitialized = !this.failed
    this.MAX_ITERATIONS = Math.min(
      this.MAX_ITERATIONS,
      this.params.maxSearchIterations,
    )
  }

  override visualize(): ReturnType<HighDensitySolverA03["visualize"]> {
    if (this.gridInitialized) return super.visualize()
    const node = this.nodeWithPortPoints
    const availableZ = node.availableZ ?? [
      ...new Set(node.portPoints.map((point) => point.z)),
    ]
    return {
      title: "Resized grid search before allocation",
      coordinateSystem: "cartesian",
      lines: [],
      circles: [],
      rects: [
        createRectFromCapacityNode(
          { ...node, availableZ, layer: `z${availableZ.join(",")}` },
          { rectMargin: 0.01 },
        ),
      ],
      points: node.portPoints.map((point) => ({
        ...point,
        label: point.connectionName,
        layer: `z${point.z}`,
      })),
    }
  }
}
