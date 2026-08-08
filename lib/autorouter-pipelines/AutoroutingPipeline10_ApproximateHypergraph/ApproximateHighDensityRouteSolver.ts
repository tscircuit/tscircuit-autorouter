import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type HighDensitySolverParams = ConstructorParameters<
  typeof HighDensitySolver
>[0]

export type ApproximateHighDensityRouteSolverParams =
  HighDensitySolverParams & {
    approximateExactPfThreshold?: number
  }

const toRoutePoint = (
  point: PortPoint,
  preserveTerminalPcbPortIds: boolean,
) => ({
  x: point.x,
  y: point.y,
  z: point.z,
  ...(preserveTerminalPcbPortIds && point.pcb_port_id
    ? { pcb_port_id: point.pcb_port_id }
    : {}),
})

/**
 * Pipeline10 deliberately defers detailed geometry. This solver turns each
 * region assignment into a straight segment and only materializes the minimum
 * valid via geometry needed for later stitching and global repair.
 */
export class ApproximateHighDensityRouteSolver extends BaseSolver {
  readonly routes: HighDensityIntraNodeRoute[] = []
  private readonly viaDiameter: number
  private readonly traceWidth: number
  private readonly preserveTerminalPcbPortIds: boolean
  private readonly exactPfThreshold: number

  constructor(
    private readonly params: ApproximateHighDensityRouteSolverParams,
  ) {
    super()
    this.viaDiameter = params.viaDiameter ?? 0.6
    this.traceWidth = params.traceWidth ?? 0.15
    this.preserveTerminalPcbPortIds =
      params.preserveTerminalPcbPortIds ?? false
    this.exactPfThreshold = params.approximateExactPfThreshold ?? 0.3
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "ApproximateHighDensityRouteSolver"
  }

  override getConstructorParams(): [ApproximateHighDensityRouteSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const nodePfById =
      this.params.nodePfById instanceof Map
        ? this.params.nodePfById
        : new Map(Object.entries(this.params.nodePfById ?? {}))
    const exactNodes: NodeWithPortPoints[] = []
    const approximateNodes: NodeWithPortPoints[] = []
    for (const node of this.params.nodePortPoints) {
      const nodePf = nodePfById.get(node.capacityMeshNodeId) ?? null
      if (
        node._isComponentTopologyNode ||
        (nodePf !== null && nodePf >= this.exactPfThreshold)
      ) {
        exactNodes.push(node)
      } else {
        approximateNodes.push(node)
      }
    }

    this.addApproximateRoutes(approximateNodes)

    let exactSolveTimeMs = 0
    if (exactNodes.length > 0) {
      const exactSolver = new HighDensitySolver({
        ...this.params,
        nodePortPoints: [...exactNodes],
      })
      const exactStartedAt = performance.now()
      exactSolver.solve()
      exactSolveTimeMs = performance.now() - exactStartedAt
      if (exactSolver.failed) {
        this.failed = true
        this.error = exactSolver.error
        return
      }
      this.routes.push(...exactSolver.routes)
    }

    const layerTransitionCount = this.routes.reduce(
      (sum, route) => sum + route.vias.length,
      0,
    )
    this.stats = {
      mode: "hybrid-straight-line",
      inputNodeCount: this.params.nodePortPoints.length,
      approximateNodeCount: approximateNodes.length,
      exactNodeCount: exactNodes.length,
      exactPfThreshold: this.exactPfThreshold,
      exactSolveTimeMs,
      routeCount: this.routes.length,
      layerTransitionCount,
    }
    this.solved = true
  }

  private addApproximateRoutes(nodes: NodeWithPortPoints[]): void {
    for (const node of nodes) {
      for (const [start, end] of node.portPointsInPairs ?? []) {
        const startRoutePoint = toRoutePoint(
          start,
          this.preserveTerminalPcbPortIds,
        )
        const endRoutePoint = toRoutePoint(
          end,
          this.preserveTerminalPcbPortIds,
        )
        const route: HighDensityIntraNodeRoute["route"] = [startRoutePoint]
        const vias: Array<{ x: number; y: number }> = []

        if (start.z !== end.z) {
          const transitionPoint = {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
          }
          route.push(
            { ...transitionPoint, z: start.z },
            { ...transitionPoint, z: end.z },
          )
          vias.push(transitionPoint)
        }
        route.push(endRoutePoint)

        this.routes.push({
          connectionName: start.connectionName,
          rootConnectionName: start.rootConnectionName,
          startPcbPortId: start.pcb_port_id,
          endPcbPortId: end.pcb_port_id,
          traceThickness: this.traceWidth,
          viaDiameter: this.viaDiameter,
          route,
          vias,
          regionId: node.capacityMeshNodeId,
        })
      }
    }
  }

  override visualize(): GraphicsObject {
    return {
      lines: this.routes.flatMap((route) =>
        route.route.slice(1).map((point, index) => ({
          points: [route.route[index]!, point],
          strokeColor: "rgba(37, 99, 235, 0.65)",
        })),
      ),
    }
  }
}
