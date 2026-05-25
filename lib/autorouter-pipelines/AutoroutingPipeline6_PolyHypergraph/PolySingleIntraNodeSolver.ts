import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { projectPointToRectBoundary } from "./geometry"
import type { PolyNodeWithPortPoints } from "./types"

type ProjectedPortRecord = {
  projected: PortPoint
  original: PortPoint
}

export class PolySingleIntraNodeSolver extends BaseSolver {
  override getSolverName(): string {
    return "PolySingleIntraNodeSolver"
  }

  highDensitySolver: HyperSingleIntraNodeSolver
  projectedNode: NodeWithPortPoints
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  projectedPorts: ProjectedPortRecord[]

  constructor(
    public params: {
      nodeWithPortPoints: PolyNodeWithPortPoints
      colorMap?: Record<string, string>
      connMap?: ConnectivityMap
      viaDiameter?: number
      traceWidth?: number
      obstacleMargin?: number
      effort?: number
    },
  ) {
    super()
    const { nodeWithPortPoints } = params
    if (!nodeWithPortPoints.projectedRect) {
      throw new Error("Poly node is missing projectedRect")
    }

    this.projectedPorts = nodeWithPortPoints.portPoints.map((portPoint) => {
      const projectedPoint = projectPointToRectBoundary(
        portPoint,
        nodeWithPortPoints.projectedRect!,
      )
      return {
        original: portPoint,
        projected: {
          ...portPoint,
          x: projectedPoint.x,
          y: projectedPoint.y,
        },
      }
    })
    this.projectedNode = {
      capacityMeshNodeId: nodeWithPortPoints.capacityMeshNodeId,
      center: nodeWithPortPoints.projectedRect.center,
      width: nodeWithPortPoints.projectedRect.width,
      height: nodeWithPortPoints.projectedRect.height,
      availableZ: nodeWithPortPoints.availableZ,
      portPoints: this.projectedPorts.map(({ projected }) => projected),
    }
    this.highDensitySolver = new HyperSingleIntraNodeSolver({
      nodeWithPortPoints: this.projectedNode,
      colorMap: params.colorMap,
      connMap: params.connMap,
      viaDiameter: params.viaDiameter,
      traceWidth: params.traceWidth,
      obstacleMargin: params.obstacleMargin,
      effort: params.effort,
    })
    this.activeSubSolver = this.highDensitySolver
    this.MAX_ITERATIONS = this.highDensitySolver.MAX_ITERATIONS + 1_000
  }

  _step() {
    this.highDensitySolver.step()
    this.progress = this.highDensitySolver.progress
    this.stats = this.highDensitySolver.stats

    if (this.highDensitySolver.solved) {
      this.solvedRoutes = this.highDensitySolver.solvedRoutes
      this.solved = true
      this.activeSubSolver = null
    } else if (this.highDensitySolver.failed) {
      this.error = this.highDensitySolver.error
      this.failed = true
      this.activeSubSolver = null
    }
  }

  getConstructorParams() {
    return [this.params] as const
  }

  visualize(): GraphicsObject {
    const node = this.params.nodeWithPortPoints
    const projectedRect = node.projectedRect
    const polygonViz: GraphicsObject = {
      polygons: [
        {
          points: node.polygon,
          fill: "rgba(60, 160, 220, 0.10)",
          stroke: "rgba(40, 90, 150, 0.7)",
          label: `${node.capacityMeshNodeId} polygon`,
        },
        ...(projectedRect
          ? [
              {
                points: projectedRect.targetQuad,
                fill: "rgba(255, 165, 0, 0.08)",
                stroke: "rgba(255, 120, 0, 0.65)",
                label: `${node.capacityMeshNodeId} distortion target`,
              },
            ]
          : []),
      ],
      rects: projectedRect
        ? [
            {
              center: projectedRect.center,
              width: projectedRect.width,
              height: projectedRect.height,
              ccwRotationDegrees: projectedRect.ccwRotationDegrees,
              fill: "rgba(255, 165, 0, 0.14)",
              stroke: "rgba(255, 120, 0, 0.8)",
              label: `${node.capacityMeshNodeId} projectedRect`,
            },
          ]
        : [],
      points: [
        ...node.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          color: "rgba(0, 80, 160, 0.85)",
          label: `${point.connectionName} original`,
        })),
        ...this.projectedPorts.map(({ projected }) => ({
          x: projected.x,
          y: projected.y,
          color: "rgba(255, 120, 0, 0.85)",
          label: `${projected.connectionName} projected`,
        })),
      ],
    }

    return combineVisualizations(polygonViz, this.highDensitySolver.visualize())
  }
}
