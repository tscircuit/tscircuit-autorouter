export type TraceId = string
export type NetId = string
export type PointId = string
export type OffBoardConnectionId = string
export type SingleLayerConnectionPoint = {
  x: number
  y: number
  layer: string
  pointId?: PointId
  pcb_port_id?: string
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

export interface SimpleRouteJson {
  layerCount: number
  minTraceWidth: number
  minViaDiameter?: number
  obstacles: Obstacle[]
  connections: Array<SimpleRouteConnection>
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  outline?: Array<{ x: number; y: number }>
  traces?: SimplifiedPcbTraces
}

export interface Obstacle {
  obstacleId?: string
  type: "rect"
  layers: string[]
  zLayers?: number[]
  center: { x: number; y: number }
  width: number
  height: number
  connectedTo: Array<TraceId | NetId>
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
