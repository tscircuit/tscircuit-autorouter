import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { computeProjectedRect } from "./geometry"
import {
  getRequiredRoutingCorridorWidth,
  shouldClampProjectionExpansion,
} from "./shouldClampProjectionExpansion"
import type { PolyNodeWithPortPoints } from "./types"

export class AttachProjectedRectsSolver extends BaseSolver {
  override getSolverName(): string {
    return "AttachProjectedRectsSolver"
  }

  outputNodes: PolyNodeWithPortPoints[] = []
  projectionAdjustmentByNodeId = new Map<string, string>()

  constructor(
    public params: {
      nodesWithPortPoints: PolyNodeWithPortPoints[]
      equivalentAreaExpansionFactor?: number
      minProjectedRectDimension?: number
      traceWidth?: number
      viaDiameter?: number
      obstacleMargin?: number
    },
  ) {
    super()
    this.MAX_ITERATIONS = 1
  }

  _step() {
    this.projectionAdjustmentByNodeId.clear()
    this.outputNodes = this.params.nodesWithPortPoints.map((node) => {
      const requestedExpansionFactor =
        this.params.equivalentAreaExpansionFactor ?? 0
      const minProjectedRectDimension =
        this.params.minProjectedRectDimension ?? 0
      const requiredRoutingCorridorWidth = getRequiredRoutingCorridorWidth({
        traceWidth: this.params.traceWidth,
        viaDiameter: this.params.viaDiameter,
        obstacleMargin: this.params.obstacleMargin,
        minProjectedRectDimension,
      })
      let projectedRect = computeProjectedRect(
        node.polygon,
        requestedExpansionFactor,
        minProjectedRectDimension,
      )

      const minDimension = Math.min(projectedRect.width, projectedRect.height)
      const nextTraceLaneWidth =
        requiredRoutingCorridorWidth + (this.params.traceWidth ?? 0)
      if (minDimension > nextTraceLaneWidth) {
        return {
          ...node,
          center: projectedRect.center,
          width: projectedRect.width,
          height: projectedRect.height,
          projectedRect,
        }
      }

      const conservativeProjectedRect = computeProjectedRect(
        node.polygon,
        1,
        minProjectedRectDimension,
      )

      if (
        shouldClampProjectionExpansion({
          node,
          projectedRect,
          conservativeProjectedRect,
          requiredRoutingCorridorWidth,
          traceWidth: this.params.traceWidth,
        })
      ) {
        projectedRect = conservativeProjectedRect
        this.projectionAdjustmentByNodeId.set(
          node.capacityMeshNodeId,
          "corridor-expansion-factor-1",
        )
      }

      return {
        ...node,
        center: projectedRect.center,
        width: projectedRect.width,
        height: projectedRect.height,
        projectedRect,
      }
    })
    this.solved = true
  }

  getOutput() {
    return this.outputNodes
  }

  getConstructorParams() {
    return [this.params] as const
  }

  visualize(): GraphicsObject {
    const nodes =
      this.outputNodes.length > 0
        ? this.outputNodes
        : this.params.nodesWithPortPoints

    return {
      polygons: nodes.map((node) => ({
        points: node.polygon,
        fill: "rgba(40, 140, 220, 0.06)",
        stroke: "rgba(20, 70, 160, 0.95)",
        strokeWidth: 0.04,
        label: `${node.capacityMeshNodeId} polygon`,
      })),
      lines: nodes.map((node) => ({
        points: [...node.polygon, node.polygon[0]!],
        strokeColor: "rgba(20, 70, 160, 0.95)",
        strokeWidth: 0.04,
        label: `${node.capacityMeshNodeId} polygon outline`,
      })),
      rects: nodes.flatMap((node) =>
        node.projectedRect
          ? [
              {
                center: node.projectedRect.center,
                width: node.projectedRect.width,
                height: node.projectedRect.height,
                ccwRotationDegrees: node.projectedRect.ccwRotationDegrees,
                fill: "rgba(255, 165, 0, 0.16)",
                stroke: "rgba(255, 140, 0, 0.8)",
                label: `${node.capacityMeshNodeId} projectedRect`,
              },
            ]
          : [],
      ),
      points: nodes.flatMap((node) =>
        node.portPoints.map((point) => ({
          x: point.x,
          y: point.y,
          color: "rgba(30, 30, 30, 0.85)",
          label: point.connectionName,
        })),
      ),
    }
  }
}
