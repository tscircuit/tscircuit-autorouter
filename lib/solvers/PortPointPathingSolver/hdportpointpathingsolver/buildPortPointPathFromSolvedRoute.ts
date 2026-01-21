import type { Candidate, SolvedRoute } from "@tscircuit/hypergraph"
import { distance } from "@tscircuit/math-utils"
import type {
  ConnectionPathResult,
  PortPointCandidate,
} from "../PortPointPathingSolver"
import type { HgPort, HgRegion } from "./buildHyperGraphFromInputNodes"

const DEFAULT_Z = 0

function getZFromLayer(layer?: string): number {
  if (!layer) return DEFAULT_Z
  const match = layer.match(/\d+/)
  if (!match) return DEFAULT_Z
  const index = Number.parseInt(match[0], 10) - 1
  return Number.isFinite(index) && index >= 0 ? index : DEFAULT_Z
}

function getLayerFromPoint(
  point: { layer?: string; layers?: string[] } | null | undefined,
): string | undefined {
  if (!point) return undefined
  if ("layers" in point && Array.isArray(point.layers)) {
    return point.layers[0]
  }
  return point.layer
}

function getCandidateRegionId(candidate: Candidate<HgRegion, HgPort>): string {
  if (candidate.nextRegion?.regionId) {
    return candidate.nextRegion.regionId
  }
  if (candidate.port.region2?.regionId) {
    return candidate.port.region2.regionId
  }
  return candidate.port.region1.regionId
}

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
  const startZ = getZFromLayer(getLayerFromPoint(startPoint))
  const endZ = getZFromLayer(getLayerFromPoint(endPoint))

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
      currentNodeId: getCandidateRegionId(candidate),
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
