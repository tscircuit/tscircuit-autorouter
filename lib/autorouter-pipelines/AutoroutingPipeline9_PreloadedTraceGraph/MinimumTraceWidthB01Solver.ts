import { HighDensitySolverB01 } from "@tscircuit/high-density-b01"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type Params = ConstructorParameters<typeof HighDensitySolverB01>[0]

export class MinimumTraceWidthB01Solver extends BaseSolver {
  readonly obstacles: NonNullable<Params["obstacles"]>
  private readonly connections: Array<{ name: string; width: number }>
  private readonly routes: HighDensityIntraNodeRoute[] = []
  private activeSolver?: HighDensitySolverB01
  MAX_RIPS?: number

  constructor(
    private readonly params: Params,
    traceWidthByConnectionName: Readonly<Record<string, number>>,
  ) {
    super()
    this.MAX_ITERATIONS = 1
    this.obstacles = params.obstacles ?? []
    const widths = new Map<string, number>()
    for (const point of params.nodeWithPortPoints.portPoints) {
      widths.set(
        point.connectionName,
        Math.max(
          params.traceThickness ?? 0.1,
          traceWidthByConnectionName[point.connectionName] ?? 0,
          traceWidthByConnectionName[point.rootConnectionName ?? ""] ?? 0,
        ),
      )
    }
    this.connections = [...widths]
      .map(([name, width]) => ({ name, width }))
      .sort((a, b) => b.width - a.width)
  }

  override _step(): void {
    if (this.activeSolver) {
      this.activeSolver.step()
      if (this.activeSolver.failed) {
        this.failed = true
        this.error = this.activeSolver.error
        return
      }
      if (!this.activeSolver.solved) return
      this.routes.push(...this.activeSolver.getOutput())
      this.activeSolver = undefined
      this.connections.shift()
    }
    const connection = this.connections[0]
    if (!connection) {
      this.solved = true
      return
    }
    this.activeSolver = new HighDensitySolverB01({
      ...this.params,
      traceThickness: connection.width,
      nodeWithPortPoints: {
        ...this.params.nodeWithPortPoints,
        portPoints: this.params.nodeWithPortPoints.portPoints.filter(
          (point) => point.connectionName === connection.name,
        ),
      },
      obstacles: [
        ...(this.params.obstacles ?? []),
        ...this.routes.map((route) => ({ type: "route" as const, ...route })),
      ],
    })
    this.MAX_ITERATIONS += this.activeSolver.MAX_ITERATIONS + 1
    if (this.MAX_RIPS !== undefined) this.activeSolver.MAX_RIPS = this.MAX_RIPS
  }

  getOutput(): HighDensityIntraNodeRoute[] {
    if (!this.solved) {
      throw new Error("Minimum-width B01 routing has not completed")
    }
    return this.routes
  }

  override visualize(): GraphicsObject {
    if (this.activeSolver) return this.activeSolver.visualize()
    return {
      lines: this.routes.flatMap((route) =>
        route.route.slice(1).map((point, index) => ({
          points: [route.route[index], point],
          strokeWidth: route.traceThickness,
          layer: `z${point.z}`,
        })),
      ),
    }
  }
}
