import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { BgaRoutingGrid } from "./BgaRoutingGrid"

type CopperPrimitive = {
  bounds: SimpleRouteJson["bounds"]
  distance: (x: number, y: number) => number
  layers: number[]
  wireClearance: number
  viaClearance: number
  pad?: boolean
  owner: number
}
const foreignCopper = -1
const geometryTolerance = 1e-8

/** Occupancy is shared by nets until two distinct owners cover the same cell. */
export class BgaRoutingCopper {
  readonly wires = new Map<number, Int32Array>()
  readonly viaKeepout: Uint8Array
  readonly viaPadOwners: Int32Array
  readonly via: ReturnType<typeof getViaDimensions>
  readonly clearance: number
  private readonly layers: number[]

  constructor(
    readonly grid: BgaRoutingGrid,
    readonly inputSrj: SimpleRouteJson,
  ) {
    this.via = getViaDimensions(inputSrj)
    this.clearance =
      inputSrj.minTraceToPadEdgeClearance ??
      inputSrj.defaultObstacleMargin ??
      0.15
    this.layers = Array.from({ length: grid.layerCount }, (_, layer) => layer)
    const owners = new Map<string, number>()
    for (const [index, connection] of inputSrj.connections.entries()) {
      owners.set(connection.name, index + 1)
      for (const point of connection.pointsToConnect) {
        if (point.pointId) owners.set(point.pointId, index + 1)
        if (point.pcb_port_id) owners.set(point.pcb_port_id, index + 1)
      }
      const width = grid.widthByConnectionName.get(connection.name)!
      if (!this.wires.has(width))
        this.wires.set(width, new Int32Array(grid.cellCount))
    }
    this.viaKeepout = new Uint8Array(grid.layerSize)
    this.viaPadOwners = new Int32Array(grid.layerSize)
    for (const obstacle of inputSrj.obstacles) {
      const owner = obstacle.connectedTo
        .map((id) => owners.get(id))
        .find((id) => id !== undefined)
      this.markObstacle(obstacle, owner ?? foreignCopper)
    }
    for (const trace of inputSrj.traces ?? [])
      this.markRoute(trace.route, foreignCopper)
  }

  private mark(primitive: CopperPrimitive): void {
    const { bounds, owner } = primitive
    const { columns, rows, origin, step, layerSize } = this.grid
    // Leave a small numerical margin on the routing grid, including inside pad channels.
    const wireMasks = [...this.wires].map(([width, mask]) => ({
      mask,
      distance: width / 2 + primitive.wireClearance + step / 25,
    }))
    const reach = Math.max(
      primitive.viaClearance,
      ...wireMasks.map((wire) => wire.distance),
    )
    const firstColumn = Math.max(
      0,
      Math.floor((bounds.minX - reach - origin.x) / step),
    )
    const lastColumn = Math.min(
      columns - 1,
      Math.ceil((bounds.maxX + reach - origin.x) / step),
    )
    const firstRow = Math.max(
      0,
      Math.floor((bounds.minY - reach - origin.y) / step),
    )
    const lastRow = Math.min(
      rows - 1,
      Math.ceil((bounds.maxY + reach - origin.y) / step),
    )
    for (let row = firstRow; row <= lastRow; row++) {
      for (let col = firstColumn; col <= lastColumn; col++) {
        const distance = primitive.distance(
          origin.x + col * step,
          origin.y + row * step,
        )
        const site = row * columns + col
        if (distance < primitive.viaClearance - geometryTolerance) {
          if (primitive.pad) {
            const previous = this.viaPadOwners[site]!
            this.viaPadOwners[site] =
              !previous || previous === owner ? owner : foreignCopper
            if (distance < this.via.holeDiameter / 2 + geometryTolerance)
              this.viaKeepout[site] = 1
          } else {
            this.viaKeepout[site] = 1
          }
        }
        for (const wire of wireMasks) {
          if (distance >= wire.distance - geometryTolerance) continue
          for (const layer of primitive.layers) {
            const cell = layer * layerSize + site
            const previous = wire.mask[cell]!
            wire.mask[cell] =
              !previous || previous === owner ? owner : foreignCopper
          }
        }
      }
    }
  }

  private markObstacle(obstacle: Obstacle, owner: number): void {
    const { center, width, height } = obstacle
    const halfWidth = width / 2
    const halfHeight = height / 2
    const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const extentX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfHeight
    const extentY = Math.abs(sin) * halfWidth + Math.abs(cos) * halfHeight
    const traceClearance = obstacle.isNonPlatedHole
      ? (this.inputSrj.minTraceToHoleEdgeClearance ?? this.clearance)
      : this.clearance
    const viaToPadClearance =
      getViaToPadClearance(this.inputSrj) ?? this.clearance
    this.mark({
      owner,
      bounds: {
        minX: center.x - extentX,
        maxX: center.x + extentX,
        minY: center.y - extentY,
        maxY: center.y + extentY,
      },
      layers: obstacle.layers.map((layer) =>
        mapLayerNameToZ(layer, this.grid.layerCount),
      ),
      distance: (x, y) => {
        const dx = x - center.x
        const dy = y - center.y
        if (obstacle.shape === "circle") return Math.hypot(dx, dy) - halfWidth
        return Math.hypot(
          Math.max(0, Math.abs(cos * dx + sin * dy) - halfWidth),
          Math.max(0, Math.abs(cos * dy - sin * dx) - halfHeight),
        )
      },
      wireClearance: traceClearance,
      viaClearance:
        this.via.padDiameter / 2 + viaToPadClearance + geometryTolerance,
      pad: true,
    })
  }

  markRoute(route: SimplifiedPcbTrace["route"], owner: number): void {
    for (const [index, point] of route.entries()) {
      if (point.route_type === "via") {
        const padDiameter = point.via_diameter ?? this.via.padDiameter
        const holeDiameter = point.via_hole_diameter ?? this.via.holeDiameter
        const holeClearance =
          this.inputSrj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0
        this.mark({
          owner,
          bounds: {
            minX: point.x,
            maxX: point.x,
            minY: point.y,
            maxY: point.y,
          },
          distance: (x, y) => Math.hypot(x - point.x, y - point.y),
          layers: this.layers,
          wireClearance: padDiameter / 2 + this.clearance,
          viaClearance:
            Math.max(
              (padDiameter + this.via.padDiameter) / 2 + this.clearance,
              (holeDiameter + this.via.holeDiameter) / 2 + holeClearance,
            ) + geometryTolerance,
        })
      } else if (point.route_type === "wire") {
        const end = route[index + 1]
        if (end?.route_type !== "wire" || point.layer !== end.layer) continue
        const dx = end.x - point.x
        const dy = end.y - point.y
        const squaredLength = dx * dx + dy * dy
        const width = Math.max(point.width, end.width)
        this.mark({
          owner,
          bounds: {
            minX: Math.min(point.x, end.x),
            maxX: Math.max(point.x, end.x),
            minY: Math.min(point.y, end.y),
            maxY: Math.max(point.y, end.y),
          },
          layers: [mapLayerNameToZ(point.layer, this.grid.layerCount)],
          distance: (x, y) => {
            const projection = (x - point.x) * dx + (y - point.y) * dy
            const ratio = squaredLength
              ? Math.max(0, Math.min(1, projection / squaredLength))
              : 0
            return Math.hypot(
              x - point.x - ratio * dx,
              y - point.y - ratio * dy,
            )
          },
          wireClearance: width / 2 + this.clearance,
          viaClearance:
            (width + this.via.padDiameter) / 2 +
            this.clearance +
            geometryTolerance,
        })
      } else {
        throw new Error(
          `Unsupported fixed copper in BGA escape route: ${point.route_type}`,
        )
      }
    }
  }

  canPlaceVia(site: number, owner: number): boolean {
    const padOwner = this.viaPadOwners[site]
    return this.viaKeepout[site] === 0 && (padOwner === 0 || padOwner === owner)
  }
}
