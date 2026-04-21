export type TraceId = string
export type NetId = string
export type PointId = string
export type OffBoardConnectionId = string
export type ObstacleId = string
export type RootConnectionName = string
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
  obstacles: Obstacle[]
  connections: Array<SimpleRouteConnection>
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  outline?: Array<{ x: number; y: number }>
  traces?: SimplifiedPcbTraces
  jumpers?: Jumper[]
  allowJumpers?: boolean
  /** Available jumper types for routing. Defaults to ["0603"] */
  availableJumperTypes?: JumperType[]
}

export interface Obstacle {
  obstacleId?: string
  type: "rect"
  layers: string[]
  zLayers?: number[]
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
  rootConnectionName?: string
  mergedConnectionNames?: string[]
  isOffBoard?: boolean
  netConnectionName?: string
  nominalTraceWidth?: number
  pointsToConnect: Array<ConnectionPoint>

  /** @deprecated DO NOT USE **/
  externallyConnectedPointIds?: PointId[][]
}

export interface SimplifiedPcbTrace {
  type: "pcb_trace"
  pcb_trace_id: TraceId
  connection_name: string
  route: Array<
    | {
        route_type: "wire"
        x: number
        y: number
        width: number
        layer: string
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
  >
}

export type SimplifiedPcbTraces = Array<SimplifiedPcbTrace>

export {
  isMultiLayerConnectionPoint,
  isSingleLayerConnectionPoint,
  getConnectionPointLayer,
  getConnectionPointLayers,
} from "../utils/connection-point-utils"
