export type TraceId = string
export type NetId = string
export type BusId = string
export type PointId = string
export type OffBoardConnectionId = string
export type ObstacleId = string
export type RootConnectionName = string
export type CircuitJsonMetadata = {
  pcb_smtpad_id?: string
  pcb_plated_hole_id?: string
  pcb_port_id?: string
  pcb_via_id?: string
  source_component_name?: string
  source_port_name?: string
}
export type TerminalViaHint = {
  toLayer: string
  viaDiameter?: number
}
export type SingleLayerConnectionPoint = {
  x: number
  y: number
  layer: string
  pointId?: PointId
  pcb_port_id?: string
  terminalVia?: TerminalViaHint
}
export type MultiLayerConnectionPoint = {
  x: number
  y: number
  layers: string[]
  pointId?: PointId
  busId?: BusId
  pcb_port_id?: string
}
export type ConnectionPoint =
  | SingleLayerConnectionPoint
  | MultiLayerConnectionPoint

export type PointKey = string
export type ConnectionTempId = string

export type Jumper = {
  jumper_footprint: "0603" | "1206x4"
  center: { x: number; y: number }
  orientation: "horizontal" | "vertical"
  width: number
  height: number
  pads: Obstacle[]
}

export type JumperType = "1206x4" | "0603"

export interface SimpleRouteJson {
  layerCount: number
  minTraceWidth: number
  nominalTraceWidth?: number
  /** @deprecated Use `min_via_pad_diameter` / `minViaPadDiameter` instead. */
  minViaDiameter?: number
  minViaHoleDiameter?: number
  minViaPadDiameter?: number
  min_via_hole_diameter?: number
  min_via_pad_diameter?: number
  defaultObstacleMargin?: number
  minTraceToPadEdgeClearance?: number
  minViaEdgeToPadEdgeClearance?: number
  obstacles: Obstacle[]
  connections: Array<SimpleRouteConnection>
  differentialPairs?: Array<DifferentialPair>
  buses?: Array<SimpleRouteBus>
  /**
   * Allows DRC repair to place layer transitions inside connected pads.
   * Defaults to false because via-in-pad generally requires filled and capped vias.
   */
  allowViaInPad?: boolean
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  outline?: Array<{ x: number; y: number }>
  traces?: SimplifiedPcbTraces
  jumpers?: Jumper[]
  allowJumpers?: boolean
  /** Available jumper types for routing. Defaults to ["0603"] */
  availableJumperTypes?: JumperType[]
}

export interface DifferentialPair {
  connectionNames: [string, string]
  /** Maximum permitted routed-length difference in millimeters. */
  lengthTolerance: number
  /** Resolved edge-to-edge copper gap in millimeters. */
  traceGap?: number
  /** Maximum permitted length routed without pair coupling, in millimeters. */
  maxUncoupledLength?: number
}

export interface SimpleRouteBus {
  busId: BusId
  /** SimpleRouteJson connection names belonging to this bus, in bus order. */
  connectionNames: string[]
  /** Maximum permitted routed-length difference in millimeters. */
  maxLengthSkew?: number
  /** Resolved copper width in millimeters for members without an override. */
  traceWidth?: number
  /** Layers on which this bus may be routed, including its terminal layers. */
  allowedLayers?: string[]
}

export interface Obstacle {
  obstacleId?: string
  /** Optional source component identifier associated with this obstacle. */
  componentId?: string
  /**
   * Optional Circuit JSON provenance carried through SRJ.
   * Routing algorithms must not use this field.
   */
  circuitJsonMetadata?: CircuitJsonMetadata
  type: "rect"
  layers: string[]
  /** Public z-layer indexes supplied by SimpleRouteJson producers. */
  zLayers?: number[]
  /** Canonicalized z-layer indexes used by autorouter internals. */
  __zLayers?: number[]
  center: { x: number; y: number }
  width: number
  height: number
  /** Optional counter-clockwise rotation metadata in degrees. */
  ccwRotationDegrees?: number
  connectedTo: Array<TraceId | NetId>
  isCopperPour?: boolean
  netIsAssignable?: boolean
  offBoardConnectsTo?: Array<OffBoardConnectionId>
}

export interface SimpleRouteConnection {
  name: string
  rootConnectionName?: RootConnectionName
  mergedConnectionNames?: string[]
  __rootConnectionNames?: string[]
  isOffBoard?: boolean
  netConnectionName?: string
  __netConnectionName?: string
  nominalTraceWidth?: number
  pointsToConnect: Array<ConnectionPoint>

  /** @deprecated DO NOT USE **/
  externallyConnectedPointIds?: PointId[][]
}

export interface SimplifiedPcbTrace {
  type: "pcb_trace"
  pcb_trace_id: TraceId
  /** Preloaded trace intentionally replaced by this routed output. */
  __replaces_pcb_trace_id?: TraceId
  connection_name: string
  connectsTo?: Array<TraceId | NetId | PointId>
  route: Array<
    | {
        route_type: "wire"
        x: number
        y: number
        width: number
        layer: string
        start_pcb_port_id?: string
        end_pcb_port_id?: string
      }
    | {
        route_type: "via"
        x: number
        y: number
        to_layer: string
        from_layer: string
        via_diameter?: number
        via_hole_diameter?: number
      }
    | {
        route_type: "jumper"
        /** Starting point of the jumper pad */
        start: { x: number; y: number }
        /** Ending point of the jumper pad */
        end: { x: number; y: number }
        /** Footprint size, typically "0603" */
        footprint: "0603" | "1206" | "1206x4_pair"
        layer: string
      }
    | {
        route_type: "through_obstacle"
        start: { x: number; y: number }
        end: { x: number; y: number }
        from_layer: string
        to_layer: string
        width: number
      }
  >
}

export type SimplifiedPcbTraces = Array<SimplifiedPcbTrace>

export {
  isMultiLayerConnectionPoint,
  isSingleLayerConnectionPoint,
  getConnectionPointLayer,
  getConnectionPointLayers,
} from "../utils/connection-point-utils"
