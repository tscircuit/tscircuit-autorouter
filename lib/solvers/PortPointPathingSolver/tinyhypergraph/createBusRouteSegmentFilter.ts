import type { BusRoutingLayers } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/busRoutingLayers"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"
import type { PortId, RegionId } from "tiny-hypergraph/lib/types"

export interface BusRoutingConstraints {
  layers: BusRoutingLayers
  escapeViaClearance: number
}

function getTerminalEscape(
  terminalPort: PortId,
  topology: TinyHyperGraphTopology,
): {
  terminalPort: PortId
  boundary: Set<PortId>
  adjacentRegions: Set<RegionId>
  radius: number
} {
  const regions = topology.incidentPortRegion[terminalPort]!
  const boundary = new Set(
    regions.flatMap((id) => topology.regionIncidentPorts[id]!),
  )
  return {
    terminalPort,
    boundary,
    adjacentRegions: new Set(
      [...boundary].flatMap((port) => topology.incidentPortRegion[port]!),
    ),
    radius: Math.max(
      ...regions.map((id) =>
        Math.hypot(topology.regionWidth[id]!, topology.regionHeight[id]!),
      ),
    ),
  }
}

export function createBusRouteSegmentFilter(
  graph: {
    topology: TinyHyperGraphTopology
    problem: TinyHyperGraphProblem
  },
  { layers, escapeViaClearance }: BusRoutingConstraints,
): TinyHyperGraphProblem["routeSegmentFilter"] {
  const { topology, problem } = graph
  const { portZ, portX, portY } = topology
  const restrictions = Array.from({ length: problem.routeCount }, (_, id) => {
    const connectionId: unknown = problem.routeMetadata?.[id]?.connectionId
    if (typeof connectionId !== "string") return
    const allowed = layers.get(connectionId)
    if (!allowed) return
    const start = problem.routeStartPort[id]!
    const end = problem.routeEndPort[id]!
    const escapes = [start, end]
      .filter((port) => !allowed.has(portZ[port]!))
      .map((port) => getTerminalEscape(port, topology))
    // Keep the detailed router's temporary detours for single-layer routes
    // that already reach that layer at both ends. Cleanup checks the output.
    if (escapes.length === 0 && allowed.size === 1) return

    let sharedEscapeRegions: Set<RegionId> | undefined
    const [startEscape, endEscape] = escapes
    if (startEscape && endEscape) {
      sharedEscapeRegions = new Set(
        [...startEscape.adjacentRegions].filter((region) =>
          endEscape.adjacentRegions.has(region),
        ),
      )
    }
    return { allowed, start, end, escapes, sharedEscapeRegions }
  })
  if (!restrictions.some(Boolean)) return

  return (routeId, regionId, from, to) => {
    const restriction = restrictions[routeId]
    if (!restriction) return true
    const { allowed, start, end, escapes, sharedEscapeRegions } = restriction
    const fromAllowed = allowed.has(portZ[from]!)
    const toAllowed = allowed.has(portZ[to]!)
    if (fromAllowed && toAllowed) return true
    if (fromAllowed || toAllowed) {
      if (sharedEscapeRegions?.has(regionId)) return false
      if (toAllowed) [from, to] = [to, from]
      return escapes.some(
        ({ terminalPort, boundary, radius }) =>
          portZ[to] === portZ[terminalPort] &&
          boundary.has(to) &&
          Math.hypot(
            portX[from]! - portX[terminalPort]!,
            portY[from]! - portY[terminalPort]!,
          ) <=
            radius + escapeViaClearance,
      )
    }
    if (portZ[from] !== portZ[to]) return false
    if (to === start || to === end) [from, to] = [to, from]
    if ((from === start && to === end) || (from === end && to === start)) {
      return false
    }
    return escapes.some(
      ({ terminalPort, boundary }) => from === terminalPort && boundary.has(to),
    )
  }
}
