import Flatbush from "flatbush"
import {
  getPipeline9PhysicalObstacleOwner,
  getPipeline9PhysicalOwnership,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalOwnership"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { acceptKrtBranches } from "./acceptKrtBranches"
import { obstacleDistance, segmentDistance } from "./GeometryAutoroutingPipelineSolver"
import { getKrtUnsupportedFeatureReason } from "./getKrtUnsupportedFeatureReason"
import { getKrtBranches } from "./getKrtBranches"

type Point = { x: number; y: number }
export type CertifiedDirectRoutingDiagnostics = {
  branchCount: number
  checkedBranches: number
  geometryChecks: number
  candidatesChecked: number
  rejectedBranch?: string
}
export type CertifiedDirectRoutingPlan = {
  eligible: true
  traces: SimplifiedPcbTraces
  diagnostics: CertifiedDirectRoutingDiagnostics
} | {
  eligible: false
  reason: string
  diagnostics: CertifiedDirectRoutingDiagnostics
}

const isSegmentInsideBoard = (
  srj: SimpleRouteJson, a: Point, b: Point, radius: number,
): boolean => {
  const clearance = radius + (srj.minBoardEdgeClearance ?? 0)
  const outline = srj.outline ?? [
    { x: srj.bounds.minX, y: srj.bounds.minY }, { x: srj.bounds.maxX, y: srj.bounds.minY },
    { x: srj.bounds.maxX, y: srj.bounds.maxY }, { x: srj.bounds.minX, y: srj.bounds.maxY },
  ]
  for (const point of [a, b]) {
    if (point.x < srj.bounds.minX + clearance || point.x > srj.bounds.maxX - clearance ||
      point.y < srj.bounds.minY + clearance || point.y > srj.bounds.maxY - clearance) return false
    let inside = false
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const p = outline[i], q = outline[j]
      if ((p.y > point.y) !== (q.y > point.y) && point.x < (q.x - p.x) * (point.y - p.y) / (q.y - p.y) + p.x) inside = !inside
    }
    if (!inside) return false
  }
  return outline.every((point, index) =>
    segmentDistance(a, b, point, outline[(index + 1) % outline.length]) >= clearance,
  )
}

/** Constructively qualify complete, zero-via straight routing before selection. */
export const getCertifiedDirectRoutingPlan = (
  original: SimpleRouteJson,
): CertifiedDirectRoutingPlan => {
  const diagnostics: CertifiedDirectRoutingDiagnostics = { branchCount: 0, checkedBranches: 0, geometryChecks: 0, candidatesChecked: 0 }
  const unsupported = getKrtUnsupportedFeatureReason(original)
  if (unsupported) return { eligible: false, reason: unsupported, diagnostics }
  diagnostics.branchCount = original.connections.reduce((count, connection) => count + Math.max(0, connection.pointsToConnect.length - 1), 0)
  // Bound applicability work; the selected original Pipeline9 keeps its caps.
  if (diagnostics.branchCount > 128) return { eligible: false, reason: "direct-certificate-branch-limit", diagnostics }
  if (original.layerCount > 32 || original.obstacles.length > 1024) return { eligible: false, reason: "direct-certificate-geometry-limit", diagnostics }
  const rules = [original.defaultObstacleMargin ?? 0.1, original.minTraceToHoleEdgeClearance ?? 0,
    original.minBoardEdgeClearance ?? 0, original.minViaHoleEdgeToViaHoleEdgeClearance ?? 0]
  if (!Number.isInteger(original.layerCount) || original.layerCount < 1 ||
    !Number.isFinite(original.minTraceWidth) || original.minTraceWidth <= 0 ||
    rules.some((value) => !Number.isFinite(value) || value < 0) ||
    !Object.values(original.bounds).every(Number.isFinite) ||
    original.bounds.minX >= original.bounds.maxX || original.bounds.minY >= original.bounds.maxY ||
    original.outline?.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
    original.obstacles.some((obstacle) => ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height,
      obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) || obstacle.width <= 0 || obstacle.height <= 0)) {
    throw new Error("Certified direct routing requires finite manufactured geometry and nonnegative clearances")
  }
  const ownership = getPipeline9PhysicalOwnership({ originalSrj: original })
  if (ownership.diagnostics.duplicateOriginalConnectionNames.length || ownership.diagnostics.ambiguousOriginalAliases.length) {
    return { eligible: false, reason: "ambiguous-original-electrical-identity", diagnostics }
  }
  const layers: string[] = Array.from({ length: original.layerCount }, (_, z) => mapZToLayerName(z, original.layerCount))
  const branches = getKrtBranches(original)
  const index = original.obstacles.length ? new Flatbush(original.obstacles.length) : null
  for (const obstacle of original.obstacles) {
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const halfWidth = obstacle.shape === "circle" ? Math.max(obstacle.width, obstacle.height) / 2 :
      (Math.abs(obstacle.width * Math.cos(angle)) + Math.abs(obstacle.height * Math.sin(angle))) / 2
    const halfHeight = obstacle.shape === "circle" ? halfWidth :
      (Math.abs(obstacle.width * Math.sin(angle)) + Math.abs(obstacle.height * Math.cos(angle))) / 2
    index!.add(obstacle.center.x - halfWidth, obstacle.center.y - halfHeight, obstacle.center.x + halfWidth, obstacle.center.y + halfHeight)
  }
  index?.finish()
  const obstacleOwners = original.obstacles.map((obstacle) => getPipeline9PhysicalObstacleOwner(ownership, obstacle))
  const traces: SimplifiedPcbTraces = []
  const committed: Array<{ a: Point; b: Point; layer: string; width: number; owner: string }> = []
  for (const branch of branches) {
    diagnostics.checkedBranches++
    const [a, b] = branch.points
    const owner = ownership.connectionOwners[branch.connection.name]
    if (!owner) throw new Error(`Certified direct branch lacks original electrical owner: ${branch.connection.name}`)
    const width = Math.max(original.minTraceWidth, branch.connection.nominalTraceWidth ?? branch.connection.width ?? original.nominalTraceWidth ?? original.minTraceWidth)
    if (![a.x, a.y, b.x, b.y, width].every(Number.isFinite) || width <= 0) {
      throw new Error(`Certified direct branch has invalid geometry: ${branch.name}`)
    }
    const startLayers = getConnectionPointLayers(a), endLayers = getConnectionPointLayers(b)
    if ([...startLayers, ...endLayers].some((layer) => !layers.includes(layer))) throw new Error(`Certified direct terminal layer outside original board: ${branch.name}`)
    const commonLayers = startLayers.filter((layer) => endLayers.includes(layer))
    const copperGap = original.defaultObstacleMargin ?? 0.1
    const holeGap = original.minTraceToHoleEdgeClearance ?? copperGap
    const extent = width / 2 + Math.max(copperGap, holeGap)
    const nearby = index?.search(Math.min(a.x, b.x) - extent, Math.min(a.y, b.y) - extent,
      Math.max(a.x, b.x) + extent, Math.max(a.y, b.y) + extent) ?? []
    let selectedLayer: string | undefined
    for (const layer of commonLayers) {
      diagnostics.candidatesChecked++
      if (!isSegmentInsideBoard(original, a, b, width / 2)) continue
      let clear = true
      for (const obstacleIndex of nearby) {
        const obstacle = original.obstacles[obstacleIndex]
        if (!obstacle.isNonPlatedHole && !obstacle.layers.includes(layer)) continue
        if (!obstacle.isNonPlatedHole && obstacleOwners[obstacleIndex] === owner) continue
        diagnostics.geometryChecks++
        if (obstacleDistance(a, b, obstacle) < width / 2 + (obstacle.isNonPlatedHole ? holeGap : copperGap)) { clear = false; break }
      }
      if (!clear) continue
      for (const segment of committed) {
        if (segment.layer !== layer || segment.owner === owner) continue
        diagnostics.geometryChecks++
        if (segmentDistance(a, b, segment.a, segment.b) < (width + segment.width) / 2 + copperGap) { clear = false; break }
      }
      if (clear) { selectedLayer = layer; break }
    }
    if (selectedLayer === undefined) {
      diagnostics.rejectedBranch = branch.name
      return { eligible: false, reason: commonLayers.length ? "no-clear-direct-layer" : "terminal-layer-transition-required", diagnostics }
    }
    committed.push({ a, b, layer: selectedLayer, width, owner })
    traces.push({ type: "pcb_trace", pcb_trace_id: branch.name, connection_name: branch.name,
      route: [a, b].map((point) => ({ route_type: "wire", x: point.x, y: point.y, layer: selectedLayer!, width })),
    })
  }
  // An unexpected qualification failure is a real error, never a reason to
  // conceal a bad certificate by trying the general solver afterwards.
  const accepted = acceptKrtBranches({ original, branches, proposed: traces, gridStep: 1e-7 })
  return { eligible: true, traces: accepted, diagnostics }
}
