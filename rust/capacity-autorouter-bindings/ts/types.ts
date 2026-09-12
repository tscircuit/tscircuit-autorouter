import type { NodeWithPortPoints } from "lib/types/high-density-types"

export type HighDensityHyperParameters = {
  shuffleSeed: number
  ripCost: number
  ripTracePenalty: number
  ripViaPenalty: number
  viaBaseCost: number
  greedyMultiplier: number
}

export interface HighDensitySolverA01Props {
  nodeWithPortPoints: NodeWithPortPoints
  cellSizeMm: number
  viaDiameter: number
  maxCellCount?: number
  stepMultiplier?: number
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  effort?: number
  hyperParameters?: Partial<HighDensityHyperParameters>
  initialPenaltyFn?: (params: {
    x: number
    y: number
    px: number
    py: number
    row: number
    col: number
  }) => number
}

export interface HighDensitySolverA03Props {
  nodeWithPortPoints: NodeWithPortPoints
  highResolutionCellSize?: number
  highResolutionCellThickness?: number
  lowResolutionCellSize?: number
  viaDiameter: number
  maxCellCount?: number
  stepMultiplier?: number
  traceThickness?: number
  traceMargin?: number
  viaMinDistFromBorder?: number
  showPenaltyMap?: boolean
  showUsedCellMap?: boolean
  effort?: number
  hyperParameters?: Partial<HighDensityHyperParameters>
  initialPenaltyFn?: (params: {
    x: number
    y: number
    px: number
    py: number
    cellId: number
    region: "left" | "top" | "right" | "bottom" | "middle"
    row: number
    col: number
  }) => number
}

export type HighDensityVariant = "a01" | "a03"

export type HighDensityProps = {
  a01: HighDensitySolverA01Props
  a03: HighDensitySolverA03Props
}
