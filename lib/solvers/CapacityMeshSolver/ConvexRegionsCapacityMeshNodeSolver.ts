import { computeConvexRegions } from "@tscircuit/find-convex-regions"
import { RectDiffPipeline } from "@tscircuit/rectdiff"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type {
  CapacityMeshNode,
  CapacityMeshPoint,
  ConnectionPoint,
  Obstacle,
  SimpleRouteJson,
} from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  createNormalizedPolygonKey,
  getBoundsFromPoints,
  isPointInNode,
} from "lib/utils/capacityMeshNodeGeometry"

type LayerNodeSeed = {
  polygon: CapacityMeshPoint[]
  availableZ: number[]
  layer: string
  _containsObstacle?: boolean
  _containsTarget?: boolean
}

const polygonFromObstacle = (
  obstacle: Obstacle,
  clearance: number,
): CapacityMeshPoint[] => {
  const halfWidth = obstacle.width / 2 + clearance
  const halfHeight = obstacle.height / 2 + clearance
  const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  const localCorners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]

  return localCorners.map((corner) => ({
    x: obstacle.center.x + corner.x * cos - corner.y * sin,
    y: obstacle.center.y + corner.x * sin + corner.y * cos,
  }))
}

const getPointLayers = (point: ConnectionPoint, layerCount: number) =>
  getConnectionPointLayers(point).map((layer) =>
    mapLayerNameToZ(layer, layerCount),
  )

const getObstacleZLayers = (obstacle: Obstacle, layerCount: number) =>
  obstacle.zLayers ??
  obstacle.layers.map((layerName) => mapLayerNameToZ(layerName, layerCount))

export class ConvexRegionsCapacityMeshNodeSolver extends BaseSolver {
  outputNodes: CapacityMeshNode[] = []
  fallbackUsed = false

  constructor(
    private readonly srj: SimpleRouteJson,
    private readonly opts: { clearance?: number } = {},
  ) {
    super()
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "ConvexRegionsCapacityMeshNodeSolver"
  }

  private buildLayerSeeds(layer: number): LayerNodeSeed[] {
    const clearance =
      this.opts.clearance ?? this.srj.defaultObstacleMargin ?? 0.15
    const layerPoints = this.srj.connections.flatMap((connection) =>
      connection.pointsToConnect.filter((point) =>
        getPointLayers(point, this.srj.layerCount).includes(layer),
      ),
    )

    const layerObstacles = this.srj.obstacles.filter((obstacle) =>
      getObstacleZLayers(obstacle, this.srj.layerCount).includes(layer),
    )

    const convexResult = computeConvexRegions({
      bounds: this.srj.bounds,
      rects: layerObstacles.map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        ccwRotation:
          (((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180) %
          (Math.PI * 2),
      })),
      clearance,
      concavityTolerance: 0,
    })

    const seeds: LayerNodeSeed[] = convexResult.regions.map((polygon) => ({
      polygon,
      availableZ: [layer],
      layer: `z${layer}`,
    }))

    for (const obstacle of layerObstacles) {
      const polygon = polygonFromObstacle(obstacle, clearance)
      const containsTarget = layerPoints.some((point) =>
        isPointInNode(point, {
          center: obstacle.center,
          width: obstacle.width,
          height: obstacle.height,
          polygon,
        } as CapacityMeshNode),
      )
      if (!containsTarget) {
        continue
      }
      seeds.push({
        polygon,
        availableZ: [layer],
        layer: `z${layer}`,
        _containsObstacle: true,
        _containsTarget: true,
      })
    }

    for (const point of layerPoints) {
      const containingSeed = seeds.find((seed) => {
        const bounds = getBoundsFromPoints(seed.polygon)
        return isPointInNode(point, {
          center: {
            x: (bounds.minX + bounds.maxX) / 2,
            y: (bounds.minY + bounds.maxY) / 2,
          },
          width: bounds.maxX - bounds.minX,
          height: bounds.maxY - bounds.minY,
          polygon: seed.polygon,
        } as CapacityMeshNode)
      })
      if (containingSeed) {
        containingSeed._containsTarget = true
      }
    }

    return seeds
  }

  private mergeSeedsAcrossLayers(
    layerSeeds: LayerNodeSeed[],
  ): CapacityMeshNode[] {
    const merged = new Map<string, LayerNodeSeed>()

    for (const seed of layerSeeds) {
      const key = `${createNormalizedPolygonKey(seed.polygon)}::${seed._containsObstacle ? "obs" : "free"}`
      const existing = merged.get(key)
      if (existing) {
        existing.availableZ = Array.from(
          new Set([...existing.availableZ, ...seed.availableZ]),
        ).sort((a, b) => a - b)
        existing._containsTarget =
          Boolean(existing._containsTarget) || Boolean(seed._containsTarget)
        continue
      }
      merged.set(key, {
        ...seed,
        availableZ: [...seed.availableZ],
      })
    }

    let nodeIndex = 0
    return Array.from(merged.values()).map((seed) => {
      const bounds = getBoundsFromPoints(seed.polygon)
      const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      }

      return {
        capacityMeshNodeId: `convex-${nodeIndex++}`,
        center,
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        bounds,
        polygon: seed.polygon,
        layer:
          seed.availableZ.length === 1
            ? `z${seed.availableZ[0]}`
            : `z${seed.availableZ.join(",")}`,
        availableZ: seed.availableZ,
        _containsObstacle: seed._containsObstacle,
        _containsTarget: seed._containsTarget,
      } satisfies CapacityMeshNode
    })
  }

  _step() {
    const layerSeeds: LayerNodeSeed[] = []
    for (let layer = 0; layer < this.srj.layerCount; layer++) {
      layerSeeds.push(...this.buildLayerSeeds(layer))
    }
    this.outputNodes = this.mergeSeedsAcrossLayers(layerSeeds)
    const estimatedGraphComplexity =
      this.outputNodes.length * this.srj.connections.length

    if (estimatedGraphComplexity > 5_000) {
      const legacySolver = new RectDiffPipeline({
        simpleRouteJson: this.srj as any,
      })
      legacySolver.solve()
      this.outputNodes = legacySolver.getOutput().meshNodes
      this.fallbackUsed = true
      this.stats = {
        ...this.stats,
        fallbackUsed: true,
        estimatedGraphComplexity,
      }
    }
    this.solved = true
  }

  getOutput(): { meshNodes: CapacityMeshNode[] } {
    return { meshNodes: this.outputNodes }
  }

  visualize(): GraphicsObject {
    return {
      lines: this.outputNodes.flatMap((node) => {
        const polygon = node.polygon ?? []
        if (polygon.length === 0) return []
        return [
          {
            points: [...polygon, polygon[0]],
            layer: node.layer,
            strokeColor: node._containsObstacle
              ? "rgba(255,0,0,0.6)"
              : "rgba(0,128,255,0.6)",
            label: `${node.capacityMeshNodeId}\navailableZ:${node.availableZ.join(",")}`,
          },
        ]
      }),
    }
  }
}
