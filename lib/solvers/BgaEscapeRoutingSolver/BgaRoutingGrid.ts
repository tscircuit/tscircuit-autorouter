import type { SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

export type Point = { x: number; y: number }
export type BgaGridAnchor = { center: Point; pitch: number }
export type BgaEscapeRoutingInput = {
  inputSrj: SimpleRouteJson
  bga: BgaGridAnchor
}

// An even subdivision represents both ball centers and the centerline between rows.
export const cellsPerBallPitch = 16
export const gridNeighbors = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
] as const

/** Board-world XY in mm (+X right, +Y up), with Z increasing from top to bottom. */
export class BgaRoutingGrid {
  readonly step: number
  readonly origin: Point
  readonly columns: number
  readonly rows: number
  readonly layerCount: number
  readonly layerSize: number
  readonly cellCount: number
  readonly widthByConnectionName = new Map<string, number>()

  constructor({ inputSrj, bga }: BgaEscapeRoutingInput) {
    this.step = bga.pitch / cellsPerBallPitch
    const terminalBounds = {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    }
    let maxCopperDiameter = getViaDimensions(inputSrj).padDiameter
    for (const connection of inputSrj.connections) {
      const width =
        connection.nominalTraceWidth ??
        connection.width ??
        inputSrj.minTraceWidth
      this.widthByConnectionName.set(connection.name, width)
      maxCopperDiameter = Math.max(maxCopperDiameter, width)
      for (const point of connection.pointsToConnect) {
        terminalBounds.minX = Math.min(terminalBounds.minX, point.x)
        terminalBounds.minY = Math.min(terminalBounds.minY, point.y)
        terminalBounds.maxX = Math.max(terminalBounds.maxX, point.x)
        terminalBounds.maxY = Math.max(terminalBounds.maxY, point.y)
      }
    }

    const edgeMargin =
      (inputSrj.minBoardEdgeClearance ?? 0) + maxCopperDiameter / 2
    const bounds = inputSrj.bounds
    // Give trunks four pad rows of exterior room without rasterizing the entire board.
    const routingMargin = 4 * bga.pitch
    const minX = Math.max(
      bounds.minX + edgeMargin,
      terminalBounds.minX - routingMargin,
    )
    const minY = Math.max(
      bounds.minY + edgeMargin,
      terminalBounds.minY - routingMargin,
    )
    const maxX = Math.min(
      bounds.maxX - edgeMargin,
      terminalBounds.maxX + routingMargin,
    )
    const maxY = Math.min(
      bounds.maxY - edgeMargin,
      terminalBounds.maxY + routingMargin,
    )
    this.origin = {
      x:
        bga.center.x + Math.ceil((minX - bga.center.x) / this.step) * this.step,
      y:
        bga.center.y + Math.ceil((minY - bga.center.y) / this.step) * this.step,
    }
    this.columns = Math.floor((maxX - this.origin.x) / this.step) + 1
    this.rows = Math.floor((maxY - this.origin.y) / this.step) + 1
    this.layerCount = inputSrj.layerCount
    this.layerSize = this.columns * this.rows
    this.cellCount = this.layerCount * this.layerSize
  }

  /** Persistent masks and one reusable search workspace share a 128 MiB budget. */
  fitsMemoryBudget(): boolean {
    const widthCount = new Set(this.widthByConnectionName.values()).size
    const wireBytes = this.cellCount * widthCount * Int32Array.BYTES_PER_ELEMENT
    const viaBytes =
      this.layerSize *
      (Uint8Array.BYTES_PER_ELEMENT + Int32Array.BYTES_PER_ELEMENT)
    const searchBytes =
      this.cellCount *
      (Float64Array.BYTES_PER_ELEMENT +
        Int32Array.BYTES_PER_ELEMENT +
        Uint8Array.BYTES_PER_ELEMENT)
    return (
      this.rows > 0 &&
      this.columns > 0 &&
      wireBytes + viaBytes + searchBytes <= 128 * 1024 * 1024
    )
  }

  getCell(point: Point, z: number): number | undefined {
    const column = Math.round((point.x - this.origin.x) / this.step)
    const row = Math.round((point.y - this.origin.y) / this.step)
    const outside =
      column < 0 || row < 0 || column >= this.columns || row >= this.rows
    if (outside) return
    if (!Number.isInteger(z) || z < 0 || z >= this.layerCount) {
      throw new Error(`Invalid BGA grid layer: ${z}`)
    }
    return z * this.layerSize + row * this.columns + column
  }

  getPoint(cell: number): Point {
    return {
      x: this.origin.x + (cell % this.columns) * this.step,
      y:
        this.origin.y +
        (Math.floor(cell / this.columns) % this.rows) * this.step,
    }
  }
}
