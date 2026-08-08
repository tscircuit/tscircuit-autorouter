import type {
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "../hgportpointpathingsolver/types"

export type CapacityAwarePortPointPathingSolverParams = Pick<
  HgPortPointPathingSolverParams,
  | "graph"
  | "layerCount"
  | "effort"
  | "preserveTerminalPcbPortIds"
  | "minViaPadDiameter"
> & {
  connections: ConnectionHgWithSimpleRouteConnection[]
  obstacleMargin?: number
}

export type PortalResource = {
  id: string
  regionIds: [string, string]
  z: number
  ports: RegionPortHg[]
  fixedPorts: Set<RegionPortHg>
  fixedPortByNet: Map<number, RegionPortHg>
  routeCountByNet: Map<number, number>
  historyCost: number
}

export type ViaResource = {
  id: string
  regionId: string
  capacity: number
  routeCountByNet: Map<number, number>
}

export type RegionResource = {
  id: string
  regionId: string
  capacity: number
  routeCountByNet: Map<number, number>
}

export type CapacityRoute = {
  connection: ConnectionHgWithSimpleRouteConnection
  netId: number
  startZ: number[]
  endZ: Set<number>
  portalResourceIds: string[]
  viaResourceIds: string[]
  regionResourceIds: string[]
  stateIds: string[]
  straightLineDistance: number
}

export type CapacityPathingPlan = {
  routes: CapacityRoute[]
  regionById: Map<string, RegionHg>
  portalResources: Map<string, PortalResource>
  assignedPortByResourceAndNet: Map<string, RegionPortHg>
}
