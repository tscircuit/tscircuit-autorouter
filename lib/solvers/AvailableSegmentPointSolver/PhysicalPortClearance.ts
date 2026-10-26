import { pointToBoxDistance, pointToSegmentDistance } from "@tscircuit/math-utils"
import Flatbush from "flatbush"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"

type Point3 = { x: number; y: number; z: number }
type IndexedObstacle = {
  obstacle: Obstacle
  zLayers: number[]
  cos: number
  sin: number
}

/** Certifies a trace midpoint against physical input, including unmeshed keepouts. */
export class PhysicalPortClearance {
  private readonly obstacles: IndexedObstacle[] = []
  private readonly index: Flatbush | null
  private readonly canProveClear: boolean
  private readonly copperRadius: number
  private readonly holeRadius: number
  private readonly boardRadius: number

  constructor(
    private readonly srj: SimpleRouteJson,
    traceWidth: number,
    obstacleMargin: number = 0.15,
  ) {
    const normalized = createSrjWithBoardValidObstacleLayers(srj)
    const obstacles = [...normalized.obstacles, ...(normalized.jumpers?.flatMap((jumper) => jumper.pads) ?? [])]
    this.copperRadius = traceWidth / 2 + Math.max(obstacleMargin, srj.minTraceToPadEdgeClearance ?? 0)
    this.holeRadius = traceWidth / 2 + Math.max(obstacleMargin, srj.minTraceToHoleEdgeClearance ?? 0)
    this.boardRadius = traceWidth / 2 + (srj.minBoardEdgeClearance ?? obstacleMargin)
    // Existing route copper is handled by separate graph assignments. Without
    // its complete physical geometry this optional proof remains conservative.
    const validBoard = Number.isInteger(srj.layerCount) && srj.layerCount > 0 &&
      Object.values(srj.bounds).every(Number.isFinite) &&
      srj.bounds.minX < srj.bounds.maxX && srj.bounds.minY < srj.bounds.maxY &&
      [traceWidth, obstacleMargin, srj.minTraceToPadEdgeClearance ?? 0, srj.minTraceToHoleEdgeClearance ?? 0, srj.minBoardEdgeClearance ?? 0].every((value) => Number.isFinite(value) && value >= 0) &&
      (!srj.outline || srj.outline.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
    this.canProveClear = validBoard && !srj.traces?.length && obstacles.every((obstacle) => {
      const type = obstacle.type as string
      const shape = obstacle.shape as string | undefined
      return (type === "rect" || type === "oval") &&
        (shape === undefined || shape === "circle" || shape === "oval") &&
        [obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) &&
        obstacle.width > 0 && obstacle.height > 0
    })
    this.index = this.canProveClear && obstacles.length > 0 ? new Flatbush(obstacles.length) : null
    if (!this.index) return
    for (const obstacle of obstacles) {
      const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      // Index rotated extents; an unrotated index can miss protruding corners.
      const halfWidth = (Math.abs(cos) * obstacle.width + Math.abs(sin) * obstacle.height) / 2
      const halfHeight = (Math.abs(sin) * obstacle.width + Math.abs(cos) * obstacle.height) / 2
      this.index.add(obstacle.center.x - halfWidth, obstacle.center.y - halfHeight, obstacle.center.x + halfWidth, obstacle.center.y + halfHeight)
      this.obstacles.push({ obstacle, zLayers: obstacle.__zLayers!, cos, sin })
    }
    this.index.finish()
  }

  isPointClear(point: Point3): boolean {
    if (!this.canProveClear) return false
    if (!Number.isInteger(point.z) || point.z < 0 || point.z >= this.srj.layerCount || ![point.x, point.y, this.copperRadius, this.holeRadius, this.boardRadius].every(Number.isFinite)) {
      throw new Error("Physical port clearance requires a finite point, radius and board layer")
    }
    const bounds = this.srj.bounds
    if (point.x - this.boardRadius < bounds.minX || point.x + this.boardRadius > bounds.maxX || point.y - this.boardRadius < bounds.minY || point.y + this.boardRadius > bounds.maxY) return false
    const outline = this.srj.outline
    if (outline) {
      if (!isPointInOrOnPolygon(point, outline)) return false
      for (let index = 0; index < outline.length; index++) {
        const start = outline[index]!
        const end = outline[(index + 1) % outline.length]!
        if (start.x === end.x && start.y === end.y) continue
        if (pointToSegmentDistance(point, start, end) < this.boardRadius) return false
      }
    }
    if (!this.index) return true
    const radius = Math.max(this.copperRadius, this.holeRadius)
    for (const index of this.index.search(point.x - radius, point.y - radius, point.x + radius, point.y + radius)) {
      const { obstacle, zLayers, cos, sin } = this.obstacles[index]!
      if (!zLayers.includes(point.z)) continue
      const dx = point.x - obstacle.center.x
      const dy = point.y - obstacle.center.y
      const physicalDistance = obstacle.shape === "circle" && obstacle.width === obstacle.height
        ? Math.hypot(dx, dy) - obstacle.width / 2
        : pointToBoxDistance({ x: dx * cos - dy * sin, y: dx * sin + dy * cos }, { center: { x: 0, y: 0 }, width: obstacle.width, height: obstacle.height })
      const requiredDistance = obstacle.isNonPlatedHole ? this.holeRadius : this.copperRadius
      if (physicalDistance < requiredDistance) return false
    }
    return true
  }
}
