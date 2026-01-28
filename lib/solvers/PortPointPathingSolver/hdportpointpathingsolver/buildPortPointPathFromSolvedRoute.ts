import type { Candidate, SolvedRoute } from "@tscircuit/hypergraph"
import { distance } from "@tscircuit/math-utils"
import type {
  ConnectionPathResult,
  PortPointCandidate,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type {
  HgPort,
  HgRegion,
} from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/buildHyperGraphFromInputNodes"
import { getCandidateRegionId } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/getCandidateRegionId"
import { getLayerFromPoint } from "lib/utils/getLayerFromPoint"
import { getZFromLayer } from "lib/solvers/PortPointPathingSolver/hdportpointpathingsolver/getZFromLayer"

const DEFAULT_Z = 0

/**
 * Build a PortPointCandidate path from a solved hypergraph route.
 */
export function buildPortPointPathFromSolvedRoute({
  solvedRoute,
  connectionResult,
}: {
  solvedRoute: SolvedRoute
  connectionResult: ConnectionPathResult
}): PortPointCandidate[] {
  const path: PortPointCandidate[] = []
  const connection = connectionResult.connection
  const startPoint = connection.pointsToConnect[0]
  const endPoint =
    connection.pointsToConnect[connection.pointsToConnect.length - 1]
  const startZ = getZFromLayer({
    layer: getLayerFromPoint({ point: startPoint }),
    defaultZ: DEFAULT_Z,
  })
  const endZ = getZFromLayer({
    layer: getLayerFromPoint({ point: endPoint }),
    defaultZ: DEFAULT_Z,
  })

  const startCandidate: PortPointCandidate = {
    prevCandidate: null,
    portPoint: null,
    currentNodeId: connectionResult.nodeIds[0],
    point: { x: startPoint?.x ?? 0, y: startPoint?.y ?? 0 },
    z: startZ,
    f: 0,
    g: 0,
    h: 0,
    distanceTraveled: 0,
  }
  path.push(startCandidate)

  for (const candidate of solvedRoute.path as Candidate<HgRegion, HgPort>[]) {
    const prev = path[path.length - 1]
    const portPoint = candidate.port.d
    const nextCandidate: PortPointCandidate = {
      prevCandidate: prev,
      portPoint,
      currentNodeId: getCandidateRegionId({ candidate }),
      point: { x: portPoint.x, y: portPoint.y },
      z: portPoint.z,
      f: 0,
      g: 0,
      h: 0,
      distanceTraveled: prev.distanceTraveled + distance(prev.point, portPoint),
    }
    path.push(nextCandidate)
  }

  const last = path[path.length - 1]
  const endCandidate: PortPointCandidate = {
    prevCandidate: last,
    portPoint: null,
    currentNodeId: connectionResult.nodeIds[1],
    point: { x: endPoint?.x ?? last.point.x, y: endPoint?.y ?? last.point.y },
    z: endZ,
    f: 0,
    g: 0,
    h: 0,
    distanceTraveled:
      last.distanceTraveled + distance(last.point, endPoint ?? last.point),
  }
  path.push(endCandidate)

  return path
}
