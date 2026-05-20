export type PortPoint = {
  connectionName: string
  rootConnectionName?: string
  portPointId?: string
  x: number
  y: number
  z: number
}

export type NodeWithPortPoints = {
  capacityMeshNodeId: string
  center: { x: number; y: number }
  width: number
  height: number
  portPoints: PortPoint[]
  availableZ?: number[]
  portPointsInPairs?: [PortPoint, PortPoint][]
}

/**
 * A path for a wire in high-density intra-node routing.
 *
 * Wires travel along a route, and are placed to avoid other
 * wires at the same z-level. Any time a z level is changed,
 * you must place a via.
 *
 * z is an integer corresponding to the layer index
 *
 * z=0: top layer for 2 layer boards
 * z=1: bottom layer for 2 layer boards
 *
 * z must be an integer
 */
export type HighDensityIntraNodeRoute = {
  connectionName: string
  rootConnectionName?: string
  traceThickness: number
  viaDiameter: number
  route: Array<{
    x: number
    y: number
    z: number
    insideJumperPad?: boolean
    toNextSegmentType?: "through_obstacle"
  }>
  vias: Array<{ x: number; y: number }>
  jumpers?: Jumper[]
}

export type HighDensityRoute = HighDensityIntraNodeRoute

/**
 * Extended HD route with segment ordering information for proper stitching.
 * segmentOrder indicates the position of this route segment in the overall
 * path from start to end (0 = first segment, 1 = second, etc.)
 */
export type HighDensityRouteWithOrder = HighDensityIntraNodeRoute & {
  segmentOrder: number
}

/**
 * A jumper component used to allow traces to cross on single-layer PCBs.
 * - "0603": Single 0603 jumper
 * - "1206": Single 1206 jumper
 * - "1206x4_pair": One of 4 internal jumper pairs in a 1206x4 resistor array
 */
export type Jumper = {
  route_type: "jumper"
  /** Starting point of the jumper */
  start: { x: number; y: number }
  /** Ending point of the jumper */
  end: { x: number; y: number }
  /** Footprint size */
  footprint: "0603" | "1206" | "1206x4_pair"
}

/**
 * An intra-node route that uses jumpers instead of vias for single-layer PCBs.
 */
export type HighDensityIntraNodeRouteWithJumpers = {
  connectionName: string
  rootConnectionName?: string
  traceThickness: number
  route: Array<{ x: number; y: number; z: number }>
  jumpers: Jumper[]
}
