import type { Obstacle } from "lib/types"

const AXIS_EPSILON = 1e-3

export type MissingBgaSlot = {
  row: number
  col: number
  center: { x: number; y: number }
  width: number
  height: number
}

export type BgaGapOrientation = "horizontal" | "vertical" | "diagonal"

export type BgaGap = {
  orientation: BgaGapOrientation
  row: number
  col: number
  center: { x: number; y: number }
  width: number
  height: number
  isBetweenTwoPads: boolean
}

type BgaSlot = {
  row: number
  col: number
  obstacle?: Obstacle
}

function getMinimumPositiveDiff(axisCoordinates: number[]): number | null {
  let minimumDiff = Number.POSITIVE_INFINITY

  for (let index = 1; index < axisCoordinates.length; index++) {
    const diff = axisCoordinates[index]! - axisCoordinates[index - 1]!
    if (diff > AXIS_EPSILON) {
      minimumDiff = Math.min(minimumDiff, diff)
    }
  }

  return Number.isFinite(minimumDiff) ? minimumDiff : null
}

function getUniqueSortedAxisCoordinates(axisCoordinates: number[]): number[] {
  return [...new Set(axisCoordinates)].sort((a, b) => a - b)
}

function roundCoordinate(coordinate: number): number {
  return Number(coordinate.toFixed(6))
}

export class BgaGrid {
  static fromObstacles(obstacles: Obstacle[]): BgaGrid | null {
    if (obstacles.length === 0) return null

    const xCoordinates = getUniqueSortedAxisCoordinates(
      obstacles.map((obstacle) => obstacle.center.x),
    )
    const yCoordinates = getUniqueSortedAxisCoordinates(
      obstacles.map((obstacle) => obstacle.center.y),
    )
    const pitchX = getMinimumPositiveDiff(xCoordinates)
    const pitchY = getMinimumPositiveDiff(yCoordinates)

    if (pitchX === null || pitchY === null) return null

    return new BgaGrid({
      obstacles,
      xCoordinates,
      yCoordinates,
      pitchX,
      pitchY,
    })
  }

  readonly xCoordinates: number[]
  readonly yCoordinates: number[]
  readonly pitchX: number
  readonly pitchY: number
  readonly originX: number
  readonly originY: number
  readonly rowCount: number
  readonly colCount: number
  readonly padWidth: number
  readonly padHeight: number
  readonly slots = new Map<string, BgaSlot>()

  private constructor(params: {
    obstacles: Obstacle[]
    xCoordinates: number[]
    yCoordinates: number[]
    pitchX: number
    pitchY: number
  }) {
    this.xCoordinates = params.xCoordinates
    this.yCoordinates = params.yCoordinates
    this.pitchX = params.pitchX
    this.pitchY = params.pitchY
    this.originX = this.xCoordinates[0]!
    this.originY = this.yCoordinates[0]!
    this.colCount =
      Math.round(
        (this.xCoordinates[this.xCoordinates.length - 1]! - this.originX) /
          this.pitchX,
      ) + 1
    this.rowCount =
      Math.round(
        (this.yCoordinates[this.yCoordinates.length - 1]! - this.originY) /
          this.pitchY,
      ) + 1
    this.padWidth = params.obstacles[0]!.width
    this.padHeight = params.obstacles[0]!.height

    for (const obstacle of params.obstacles) {
      const bgaSlot = this.getSlotForObstacle(obstacle)
      if (!bgaSlot) continue
      this.slots.set(this.getSlotKey(bgaSlot.row, bgaSlot.col), {
        ...bgaSlot,
        obstacle,
      })
    }
  }

  private getSlotKey(row: number, col: number): string {
    return `${row}:${col}`
  }

  private getAxisIndex(
    origin: number,
    pitch: number,
    coordinate: number,
  ): number | null {
    const axisIndex = Math.round((coordinate - origin) / pitch)
    const alignedCoordinate = origin + axisIndex * pitch
    return Math.abs(alignedCoordinate - coordinate) <= AXIS_EPSILON
      ? axisIndex
      : null
  }

  private getAxisCoordinate(
    origin: number,
    pitch: number,
    axisIndex: number,
  ): number {
    return roundCoordinate(origin + axisIndex * pitch)
  }

  hasPadAt(row: number, col: number): boolean {
    return this.slots.has(this.getSlotKey(row, col))
  }

  getSlotForObstacle(obstacle: Obstacle): { row: number; col: number } | null {
    const row = this.getAxisIndex(this.originY, this.pitchY, obstacle.center.y)
    const col = this.getAxisIndex(this.originX, this.pitchX, obstacle.center.x)

    if (row === null || col === null) return null
    if (row < 0 || row >= this.rowCount) return null
    if (col < 0 || col >= this.colCount) return null

    return { row, col }
  }

  getSlotCenter(row: number, col: number): { x: number; y: number } {
    return {
      x: this.getAxisCoordinate(this.originX, this.pitchX, col),
      y: this.getAxisCoordinate(this.originY, this.pitchY, row),
    }
  }

  getHorizontalGap(row: number, col: number): BgaGap {
    const leftPadCenter = this.getSlotCenter(row, col)
    const rightPadCenter = this.getSlotCenter(row, col + 1)

    return {
      orientation: "horizontal",
      row,
      col,
      center: {
        x: roundCoordinate((leftPadCenter.x + rightPadCenter.x) / 2),
        y: leftPadCenter.y,
      },
      width: this.pitchX - this.padWidth,
      height: this.padHeight,
      isBetweenTwoPads: this.hasPadAt(row, col) && this.hasPadAt(row, col + 1),
    }
  }

  getVerticalGap(row: number, col: number): BgaGap {
    const topPadCenter = this.getSlotCenter(row, col)
    const bottomPadCenter = this.getSlotCenter(row + 1, col)

    return {
      orientation: "vertical",
      row,
      col,
      center: {
        x: topPadCenter.x,
        y: roundCoordinate((topPadCenter.y + bottomPadCenter.y) / 2),
      },
      width: this.padWidth,
      height: this.pitchY - this.padHeight,
      isBetweenTwoPads: this.hasPadAt(row, col) && this.hasPadAt(row + 1, col),
    }
  }

  getDiagonalGap(row: number, col: number): BgaGap {
    const topLeftPadCenter = this.getSlotCenter(row, col)
    const bottomRightPadCenter = this.getSlotCenter(row + 1, col + 1)

    return {
      orientation: "diagonal",
      row,
      col,
      center: {
        x: roundCoordinate((topLeftPadCenter.x + bottomRightPadCenter.x) / 2),
        y: roundCoordinate((topLeftPadCenter.y + bottomRightPadCenter.y) / 2),
      },
      width: this.pitchX - this.padWidth,
      height: this.pitchY - this.padHeight,
      isBetweenTwoPads:
        this.hasPadAt(row, col) && this.hasPadAt(row + 1, col + 1),
    }
  }

  getDiagonalGaps(): BgaGap[] {
    const bgaGaps: BgaGap[] = []

    for (let row = 0; row < this.rowCount - 1; row++) {
      for (let col = 0; col < this.colCount - 1; col++) {
        bgaGaps.push(this.getDiagonalGap(row, col))
      }
    }

    return bgaGaps.filter(
      (bgaGap) => bgaGap.width > AXIS_EPSILON && bgaGap.height > AXIS_EPSILON,
    )
  }

  getAxisGaps(): BgaGap[] {
    const bgaGaps: BgaGap[] = []

    for (let row = 0; row < this.rowCount; row++) {
      for (let col = 0; col < this.colCount - 1; col++) {
        bgaGaps.push(this.getHorizontalGap(row, col))
      }
    }

    for (let row = 0; row < this.rowCount - 1; row++) {
      for (let col = 0; col < this.colCount; col++) {
        bgaGaps.push(this.getVerticalGap(row, col))
      }
    }

    return bgaGaps.filter(
      (bgaGap) => bgaGap.width > AXIS_EPSILON && bgaGap.height > AXIS_EPSILON,
    )
  }

  getMissingSlots(): MissingBgaSlot[] {
    const missingBgaSlots: MissingBgaSlot[] = []

    for (let row = 0; row < this.rowCount; row++) {
      for (let col = 0; col < this.colCount; col++) {
        if (this.hasPadAt(row, col)) continue

        missingBgaSlots.push({
          row,
          col,
          center: this.getSlotCenter(row, col),
          width: this.padWidth,
          height: this.padHeight,
        })
      }
    }

    return missingBgaSlots
  }
}
