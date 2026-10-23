import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type OwnershipContext = {
  srj: Omit<SimpleRouteJson, "traces"> & { traces: undefined }
  routes: HighDensityRoute[]
  routeOwnerReads: number
  obstacleOwnerReads: number
  canonicalNetCount: number
}

/** Isolate repair04's ordinary-string union from canonical net-key aliases. */
export function createPipeline9ClearanceSearchOwnershipContext(input: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  fixedObstacleRoutes: PreloadedHighDensityRoute[]
  preloadedTraces: readonly SimplifiedPcbTrace[]
  preloadedSectionTraceIndexByConnection?: ReadonlyMap<string, number>
  connMap: ConnectivityMap
}): OwnershipContext {
  const tokenByCanonical = new Map<string, string>()
  const tokenFor = (canonical: string): string => {
    let token = tokenByCanonical.get(canonical)
    if (token === undefined) {
      // No original identity is passed into the private union namespace.
      token = `pipeline9_owned_net_${tokenByCanonical.size}`
      tokenByCanonical.set(canonical, token)
    }
    return token
  }
  let routeOwnerReads = 0
  const routes = [...input.routes, ...input.fixedObstacleRoutes].map((route, index): HighDensityRoute => {
    routeOwnerReads++
    let canonical = input.connMap.getNetConnectedToId(route.connectionName)
    const sectionTraceIndex = input.preloadedSectionTraceIndexByConnection?.get(route.connectionName)
    const sourceTraceIndex = index >= input.routes.length
      ? input.fixedObstacleRoutes[index - input.routes.length]!.preloadedTraceIndex
      : sectionTraceIndex
    if (index >= input.routes.length || sectionTraceIndex !== undefined) {
      if (!Number.isInteger(sourceTraceIndex) || sourceTraceIndex! < 0) throw new Error(`Clearance ownership has an invalid preload index on ${route.connectionName}`)
      const trace = input.preloadedTraces[sourceTraceIndex!]
      if (!trace) throw new Error(`Clearance ownership lost original preload for ${route.connectionName}`)
      const byTraceId = input.connMap.getNetConnectedToId(trace.pcb_trace_id)
      const byConnection = input.connMap.getNetConnectedToId(trace.connection_name)
      if (byTraceId && byConnection && byTraceId !== byConnection) throw new Error(`Clearance ownership has inconsistent preload identities for ${route.connectionName}`)
      const preloadCanonical = byTraceId ?? byConnection
      if (preloadCanonical === undefined) throw new Error(`Clearance ownership has no certified original preload for ${route.connectionName}`)
      if (canonical !== undefined && canonical !== preloadCanonical) throw new Error(`Clearance ownership has a registered alias conflicting with original preload on ${route.connectionName}`)
      canonical = preloadCanonical
    }
    if (canonical === undefined) throw new Error(`Clearance ownership has no certified connection for ${route.connectionName}`)
    const root = route.rootConnectionName
    if (root !== undefined && root !== canonical && input.connMap.getNetConnectedToId(root) !== canonical) {
      throw new Error(`Clearance ownership has an uncertified root on ${route.connectionName}`)
    }
    const token = tokenFor(canonical)
    return { ...route, connectionName: token, rootConnectionName: token }
  })
  let obstacleOwnerReads = 0
  // Pipeline9 builds connMap from every original obstacle.connectedTo identity;
  // an unregistered identity here is an incomplete authoritative context.
  const obstacles = input.srj.obstacles.map((obstacle) => {
    const owners = obstacle.connectedTo.map((id): string => {
      obstacleOwnerReads++
      const canonical = input.connMap.getNetConnectedToId(id)
      if (canonical === undefined) throw new Error(`Clearance ownership has an unknown obstacle identity ${id}`)
      return tokenFor(canonical)
    })
    return { ...obstacle, connectedTo: [...new Set(owners)] }
  })
  // FindClearancePathSolver reads connections solely to union ownership IDs.
  // Pad/trace geometry and physical constraints remain in obstacles/routes.
  const connections = [...tokenByCanonical.values()].map((name) => ({ name, pointsToConnect: [] }))
  return { srj: { ...input.srj, traces: undefined, connections, obstacles }, routes,
    routeOwnerReads, obstacleOwnerReads, canonicalNetCount: tokenByCanonical.size }
}
