import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSimplificationConnectivityMap } from "./createSimplificationConnectivityMap"

type SimplificationRouteIdentityInput = {
  hdRoutes: ReadonlyArray<HighDensityRoute>
  otherHdRoutes: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
  netByConnectionName: ReadonlyMap<string, string> | undefined
  colorMap: Readonly<Record<string, string>>
}

type SimplificationRouteIdentities = {
  hdRoutes: HighDensityRoute[]
  otherHdRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  netByConnectionName: ReadonlyMap<string, string> | undefined
  colorMap: Readonly<Record<string, string>>
  connectionNameByInternalName: ReadonlyMap<string, string>
}

const reserveUniqueName = (
  baseName: string,
  reservedNames: Set<string>,
): string => {
  let name: string = baseName
  let collisionIndex: number = 0
  while (reservedNames.has(name)) {
    collisionIndex++
    name = `${baseName}_${collisionIndex}`
  }
  reservedNames.add(name)
  return name
}

export const createSimplificationRouteIdentities = (
  input: SimplificationRouteIdentityInput,
): SimplificationRouteIdentities => {
  const allRoutes: HighDensityRoute[] = [
    ...input.hdRoutes,
    ...input.otherHdRoutes,
  ]
  const counts: Map<string, number> = new Map()
  const reservedNames: Set<string> = new Set([
    ...Object.keys(input.connMap.idToNetMap),
    ...Object.keys(input.connMap.netMap),
    ...Object.keys(input.colorMap),
    ...input.obstacles.flatMap(
      (obstacle: Obstacle): string[] => obstacle.connectedTo,
    ),
  ])
  for (const route of allRoutes) {
    counts.set(
      route.connectionName,
      (counts.get(route.connectionName) ?? 0) + 1,
    )
    reservedNames.add(route.connectionName)
    if (route.rootConnectionName !== undefined) {
      reservedNames.add(route.rootConnectionName)
    }
  }
  for (const [connectionName, netName] of input.netByConnectionName ?? []) {
    reservedNames.add(connectionName)
    reservedNames.add(netName)
  }
  const connectionNameByInternalName: Map<string, string> = new Map()
  if (![...counts.values()].some((count: number): boolean => count > 1)) {
    return {
      ...input,
      hdRoutes: [...input.hdRoutes],
      otherHdRoutes: [...input.otherHdRoutes],
      connectionNameByInternalName,
    }
  }

  // Route names identify spatial-index entries, but several physical pieces
  // may belong to one connection. Keep their private identities distinct.
  const connMap: ConnectivityMap = input.connMap
  const netByConnectionName: Map<string, string> = new Map()
  for (const connectionName of input.netByConnectionName?.keys() ?? []) {
    const netName: string | undefined =
      connMap.getNetConnectedToId(connectionName)
    if (netName === undefined) {
      throw new Error(
        `TraceSimplificationSolver has no registered net for route "${connectionName}"`,
      )
    }
    netByConnectionName.set(connectionName, netName)
  }
  const fragmentNets: Map<string, string> = new Map()
  const netByOriginalConnectionName: Map<string, string> = new Map()
  for (const route of allRoutes) {
    if (counts.get(route.connectionName) === 1) continue
    const netName: string | undefined =
      connMap.getNetConnectedToId(route.connectionName) ??
      (route.rootConnectionName === undefined
        ? undefined
        : connMap.getNetConnectedToId(route.rootConnectionName))
    if (netName === undefined) continue
    const existingNetName: string | undefined =
      netByOriginalConnectionName.get(route.connectionName)
    if (existingNetName !== undefined && existingNetName !== netName) {
      throw new Error(
        `TraceSimplificationSolver connection "${route.connectionName}" has fragments on different nets`,
      )
    }
    netByOriginalConnectionName.set(route.connectionName, netName)
  }
  const colorMap: Record<string, string> = { ...input.colorMap }
  const routes: HighDensityRoute[] = allRoutes.map(
    (route: HighDensityRoute, routeIndex: number): HighDensityRoute => {
      if (counts.get(route.connectionName) === 1) return route
      const connectionName: string = reserveUniqueName(
        `${route.connectionName}_simplification_fragment_${routeIndex}`,
        reservedNames,
      )
      connectionNameByInternalName.set(connectionName, route.connectionName)
      let netName: string | undefined =
        netByOriginalConnectionName.get(route.connectionName)
      if (netName === undefined) {
        // Equal connection IDs already express common membership even when
        // the caller has not registered that connection in its map.
        netName = reserveUniqueName(
          `${route.connectionName}_simplification_connection`,
          reservedNames,
        )
      }
      netByOriginalConnectionName.set(route.connectionName, netName)
      fragmentNets.set(route.connectionName, netName)
      fragmentNets.set(connectionName, netName)
      netByConnectionName.set(connectionName, netName)
      const color: string | undefined = input.colorMap[route.connectionName]
      if (color !== undefined) colorMap[connectionName] = color
      return { ...route, connectionName }
    },
  )
  return {
    hdRoutes: routes.slice(0, input.hdRoutes.length),
    otherHdRoutes: routes.slice(input.hdRoutes.length),
    // Append fresh memberships together; per-fragment addConnections would
    // repeatedly scan the growing net's full membership array.
    connMap: createSimplificationConnectivityMap(connMap, fragmentNets),
    netByConnectionName,
    colorMap,
    connectionNameByInternalName,
  }
}
