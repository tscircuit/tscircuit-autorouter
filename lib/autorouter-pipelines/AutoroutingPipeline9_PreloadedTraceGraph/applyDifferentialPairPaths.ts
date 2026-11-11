import { mergeConnections } from "lib/solvers/NetToPointPairsSolver/mergeConnections"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import {
  areIdsInitiallyConnected,
  getInitiallyConnectedMapFromSimpleRouteJson,
} from "lib/utils/get-initially-connected-map-from-simple-route-json"
import { getPointKey } from "lib/utils/getPointKey"
import { planDifferentialPairSections } from "./planDifferentialPairSections"

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
} {
  if (!inputSrj.differentialPairs?.length) {
    return { srj: pointPairSrj, sectionNamesByMember: new Map() }
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
    return { srj: pointPairSrj, sectionNamesByMember }
  }

  const sections = mergedConnections
    .slice()
    .reverse()
    .flatMap(
      (connection) => sectionsByMergedConnection.get(connection.name) ?? [],
    )
  const plannedConnectivity =
    getInitiallyConnectedMapFromSimpleRouteJson(routingSrj)
  for (const section of sections) {
    const [from, to] = section.pointsToConnect
    if (
      areIdsInitiallyConnected(
        plannedConnectivity,
        getPointKey(from!),
        getPointKey(to!),
      )
    ) {
      throw new Error(
        `Differential pair section "${section.name}" already has copper and cannot be routed as a new paired section`,
      )
    }
  }
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
  for (const section of sections) {
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
      connections: [...sections, ...retainedLinks].map(
        ({ path, ...connection }) => connection,
      ),
    },
    sectionNamesByMember,
  }
}
