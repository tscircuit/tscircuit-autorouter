import type {
  TinyHyperGraphProblem,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"

export function createBusRouteSegmentFilter(
  topology: TinyHyperGraphTopology,
  problem: TinyHyperGraphProblem,
  allowedLayersByConnection: ReadonlyMap<string, ReadonlySet<number>>,
  viaClearance: number,
): TinyHyperGraphProblem["routeSegmentFilter"] {
  const { portZ, incidentPortRegion, regionIncidentPorts } = topology
  const getTerminal = (port: number) => {
    const regions = incidentPortRegion[port]!
    return {
      port,
      boundary: new Set(regions.flatMap((id) => regionIncidentPorts[id]!)),
      neighboringRegions: new Set(
        regions.flatMap((id) =>
          regionIncidentPorts[id]!.flatMap(
            (portId) => incidentPortRegion[portId]!,
          ),
        ),
      ),
      // Pad regions delimit the escape. Include the via clearance beyond the
      // pad boundary so a layer change can reach free copper.
      radius:
        Math.max(
          ...regions.map((id) =>
            Math.hypot(topology.regionWidth[id]!, topology.regionHeight[id]!),
          ),
        ) + viaClearance,
    }
  }
  const isNearTerminal = (
    terminal: ReturnType<typeof getTerminal>,
    port: number,
  ) =>
    Math.hypot(
      topology.portX[port]! - topology.portX[terminal.port]!,
      topology.portY[port]! - topology.portY[terminal.port]!,
    ) <= terminal.radius
  const restrictions = Array.from({ length: problem.routeCount }, (_, id) => {
    const name: unknown = problem.routeMetadata?.[id]?.connectionId
    const allowed =
      typeof name === "string" ? allowedLayersByConnection.get(name) : undefined
    if (!allowed) return undefined
    return {
      allowed,
      start: getTerminal(problem.routeStartPort[id]!),
      end: getTerminal(problem.routeEndPort[id]!),
    }
  })

  return (routeId, regionId, from, to) => {
    const restriction = restrictions[routeId]
    if (!restriction) return true
    const { allowed, start, end } = restriction
    const fromZ = portZ[from]!
    const toZ = portZ[to]!
    const fromAllowed = allowed.has(fromZ)
    const toAllowed = allowed.has(toZ)
    if (fromAllowed && toAllowed) return true
    if (fromAllowed || toAllowed) {
      if (
        !allowed.has(portZ[start.port]!) &&
        !allowed.has(portZ[end.port]!) &&
        start.neighboringRegions.has(regionId) &&
        end.neighboringRegions.has(regionId)
      ) {
        // Keep the two terminal escapes separate from the shared route region.
        return false
      }
      const accessPort = fromAllowed ? to : from
      const allowedPort = fromAllowed ? from : to
      return (
        (portZ[accessPort] === portZ[start.port] &&
          start.boundary.has(accessPort) &&
          isNearTerminal(start, allowedPort)) ||
        (portZ[accessPort] === portZ[end.port] &&
          end.boundary.has(accessPort) &&
          isNearTerminal(end, allowedPort))
      )
    }
    if (fromZ !== toZ) return false
    if (to === start.port || to === end.port) [from, to] = [to, from]
    // A pad may reach its local boundary on its own layer. A pad-to-pad
    // shortcut on that layer would skip the allowed routing layers entirely.
    return (
      (from === start.port && to !== end.port && start.boundary.has(to)) ||
      (from === end.port && to !== start.port && end.boundary.has(to))
    )
  }
}
