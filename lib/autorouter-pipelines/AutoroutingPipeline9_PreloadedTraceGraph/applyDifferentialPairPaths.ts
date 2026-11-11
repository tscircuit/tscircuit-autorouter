import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import type {
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import {
  areIdsInitiallyConnected,
  getInitiallyConnectedMapFromSimpleRouteJson,
} from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getPointKey } from "lib/utils/getPointKey"
import { planDifferentialPairSections } from "./planDifferentialPairSections"

export type PreloadedDifferentialPairSections = ReadonlyMap<
  string,
  { connection: SimpleRouteConnection; pcbTraceId: string }
>

/** Combine the declared sections with the links the ordinary net tree still needs. */
export function applyDifferentialPairPaths({
  inputSrj,
  routingSrj,
  pointPairSrj,
}: {
  inputSrj: SimpleRouteJson
  routingSrj: SimpleRouteJson
  pointPairSrj: SimpleRouteJson
}): {
  srj: SimpleRouteJson
  sectionNamesByMember: ReadonlyMap<string, string[]>
  preloadedSections: PreloadedDifferentialPairSections
} {
  const preloadedSections = new Map<
    string,
    { connection: SimpleRouteConnection; pcbTraceId: string }
  >()
  if (!inputSrj.differentialPairs?.length) {
    return {
      srj: pointPairSrj,
      sectionNamesByMember: new Map(),
      preloadedSections,
    }
  }

  const mergedConnections = mergeConnections(
    routingSrj.connections.filter((connection) => !connection.isOffBoard),
  )
  const { sectionsByMergedConnection, sectionNamesByMember } =
    planDifferentialPairSections(
      inputSrj,
      routingSrj.connections,
      mergedConnections,
    )
  if (sectionsByMergedConnection.size === 0) {
    return { srj: pointPairSrj, sectionNamesByMember, preloadedSections }
  }

  const sections = mergedConnections
    .slice()
    .reverse()
    .flatMap(
      (connection) => sectionsByMergedConnection.get(connection.name) ?? [],
    )
  const plannedConnectivity =
    getInitiallyConnectedMapFromSimpleRouteJson(routingSrj)
  const pathPointIds = new Set(
    sections.flatMap((section) => section.pointsToConnect.map(getPointKey)),
  )
  const matchesEndpoint = (
    point: ConnectionPoint,
    endpoint: { x: number; y: number },
  ): boolean => Math.hypot(point.x - endpoint.x, point.y - endpoint.y) <= 1e-8
  const sectionsToRoute = sections.filter((section) => {
    const [from, to] = section.pointsToConnect
    const fromId = getPointKey(from!)
    const toId = getPointKey(to!)
    if (!areIdsInitiallyConnected(plannedConnectivity, fromId, toId))
      return true

    const matches = (routingSrj.traces ?? []).filter((trace) => {
      const ids = trace.connectsTo ?? []
      if (
        !ids.includes(fromId) ||
        !ids.includes(toId) ||
        ids.some((id) => id !== fromId && id !== toId && pathPointIds.has(id))
      )
        return false
      const first = trace.route.find((entry) => entry.route_type === "wire")
      const last = trace.route.findLast((entry) => entry.route_type === "wire")
      return (
        first !== undefined &&
        last !== undefined &&
        ((matchesEndpoint(from!, first) && matchesEndpoint(to!, last)) ||
          (matchesEndpoint(from!, last) && matchesEndpoint(to!, first)))
      )
    })
    if (matches.length !== 1)
      throw new Error(
        `Differential pair section "${section.name}" is already connected and must resolve to one preloaded trace between its terminals, got ${matches.length}`,
      )
    preloadedSections.set(section.name, {
      connection: section,
      pcbTraceId: matches[0]!.pcb_trace_id,
    })
    return false
  })
  const pathRootNames = new Set(
    sections.flatMap((section) => section.__rootConnectionNames ?? []),
  )
  // The ordinary tree already spans the remaining terminals. Keep its links
  // that still connect different components after adding the declared path.
  for (const connection of routingSrj.connections) {
    if (!connection.isOffBoard) continue
    const [from, to] = connection.pointsToConnect
    if (from?.pointId && to?.pointId) {
      plannedConnectivity.addConnections([[from.pointId, to.pointId]])
    }
  }
  for (const section of sectionsToRoute) {
    plannedConnectivity.addConnections([
      section.pointsToConnect.map(getPointKey),
    ])
  }
  const linksOnPathNets = new Set<SimpleRouteConnection>()
  for (const connection of pointPairSrj.connections) {
    if (
      connection.__rootConnectionNames?.some((name) => pathRootNames.has(name))
    ) {
      linksOnPathNets.add(connection)
    } else {
      plannedConnectivity.addConnections([
        connection.pointsToConnect.map(getPointKey),
      ])
    }
  }
  const retainedLinks = pointPairSrj.connections.filter((connection) => {
    if (!linksOnPathNets.has(connection)) return true
    const [from, to] = connection.pointsToConnect
    const fromKey = getPointKey(from!)
    const toKey = getPointKey(to!)
    if (areIdsInitiallyConnected(plannedConnectivity, fromKey, toKey))
      return false
    plannedConnectivity.addConnections([[fromKey, toKey]])
    return true
  })

  return {
    srj: {
      ...pointPairSrj,
      connections: [...sectionsToRoute, ...retainedLinks].map(
        ({ path, ...connection }) => connection,
      ),
    },
    sectionNamesByMember,
    preloadedSections,
  }
}
