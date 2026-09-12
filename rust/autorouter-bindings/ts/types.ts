export type PortPoint = {
  connectionName: string
  rootConnectionName?: string
  portPointId?: string
  x: number
  y: number
  z: number
  prevPortPointId?: string
  nextPortPointId?: string
}

export type NodeWithPortPoints = {
  capacityMeshNodeId: string
  center: { x: number; y: number }
  width: number
  height: number
  portPoints: PortPoint[]
  availableZ?: number[]
}

export type HighDensityRoutePoint = {
  x: number
  y: number
  z: number
  insideJumperPad?: boolean
  portPointId?: string
}

export type Jumper = {
  route_type: "jumper"
  start: { x: number; y: number }
  end: { x: number; y: number }
  footprint: "0603" | "1206" | "1206x4_pair"
}

export type HighDensityIntraNodeRoute = {
  connectionName: string
  rootConnectionName?: string
  traceThickness: number
  viaDiameter: number
  route: HighDensityRoutePoint[]
  vias: Array<{ x: number; y: number }>
  jumpers?: Jumper[]
  regionId?: string
}

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
