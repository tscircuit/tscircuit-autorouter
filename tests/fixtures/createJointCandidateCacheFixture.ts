import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"

export function createJointCandidateCacheFixture(kind: "cycle" | "preload" | "pressure", alternative: boolean): TinyHyperGraphSolver {
  const pressure = kind === "pressure"
  const routeCount = pressure ? 3 : 4
  const portCount = pressure ? 10 : 11
  const ids = Array.from({ length: portCount }, (_, i) => i)
  const topology: TinyHyperGraphTopology = {
    portCount, regionCount: 4, regionIncidentPorts: [ids, ids, ids, ids], incidentPortRegion: ids.map(() => [0, 1, 2, 3]),
    regionWidth: new Float64Array([10, 10, 10, 10]), regionHeight: new Float64Array([10, 10, 10, 10]), regionCenterX: new Float64Array(4), regionCenterY: new Float64Array(4), regionAvailableZMask: new Int32Array([3, 3, 1, 1]),
    regionMetadata: ids.slice(0, 4).map((i) => ({ serializedRegionId: `r${i}` })), portMetadata: ids.map((i) => ({ serializedPortId: `p${i}` })),
    portX: new Float64Array(pressure ? [-2, 2, -2, 2, 0, 0, 0, 0, -1, 1] : [-2, 2, -2, 2, -2, 2, -2, 2, 0, 0, 0]),
    portY: new Float64Array(pressure ? [-1, -1, 1, 1, -4, 4, -1, 1, 3, 3] : [-1, -1, 0, 0, 1, 1, 3, 3, -1, 0, 1]),
    portZ: pressure ? new Int32Array(10) : new Int32Array([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]),
    portAngleForRegion1: new Int32Array(pressure ? [18000, 0, 18000, 0, 27000, 9000, 27000, 9000, 18000, 0] : [18000, 0, 18000, 0, 18000, 0, 10000, 8000, 27000, 9000, 4500]),
    portAngleForRegion2: new Int32Array(pressure ? [18000, 0, 18000, 0, 27000, 9000, 27000, 9000, 18000, 0] : [18000, 0, 18000, 0, 18000, 0, 10000, 8000, 27000, 9000, 4500]),
  }
  const solver = new TinyHyperGraphSolver(topology, {
    routeCount, routeStartPort: new Int32Array(ids.slice(0, routeCount).map((i) => pressure && i === 2 ? 8 : i * 2)), routeEndPort: new Int32Array(ids.slice(0, routeCount).map((i) => pressure && i === 2 ? 9 : i * 2 + 1)),
    routeNet: new Int32Array(ids.slice(0, routeCount)), regionNetId: new Int32Array(4).fill(-1), portSectionMask: new Int8Array(portCount).fill(1),
    routeMetadata: ids.slice(0, routeCount).map((i) => ({ connectionId: `route${i}`, ...(kind === "preload" && i === 3 ? { preloadedTraceSection: { traceId: "kept" } } : {}) })),
  })
  for (let route = 0; route < routeCount; route++) {
    const region = pressure ? route === 2 ? 2 : alternative ? 1 - route : route : Number(alternative)
    const portal = pressure ? 4 + route + Number(alternative) * 2 : 8 + (route + Number(alternative)) % 3
    const segments: [number, number, number][] = pressure && route === 2 ? [[route, 8, 9]] : route === 3 ? [[route, 6, 7]] : [[route, route * 2, portal], [route, portal, route * 2 + 1]]
    for (const segment of segments) {
      solver.state.regionSegments[region]!.push(segment)
      solver.state.currentRouteNetId = route
      solver.appendSegmentToRegionCache(region, segment[1], segment[2])
      solver.state.portAssignment[segment[1]] = route
      solver.state.portAssignment[segment[2]] = route
    }
  }
  solver.state.currentRouteNetId = undefined
  solver.state.unroutedRoutes = []
  solver.solved = true
  return solver
}

export function copyCompleteJointCandidate(source: TinyHyperGraphSolver): TinyHyperGraphSolver {
  // Native replay shares these immutable canonical inputs. structuredClone
  // strips their non-enumerable stable metadata IDs, invalidating provenance.
  const copy = new TinyHyperGraphSolver(source.topology, source.problem, { minViaPadDiameter: source.minViaPadDiameter, TRACE_DENSITY_COST_FACTOR: source.TRACE_DENSITY_COST_FACTOR })
  copy.state.regionSegments = structuredClone(source.state.regionSegments)
  copy.state.regionIntersectionCaches = structuredClone(source.state.regionIntersectionCaches)
  copy.state.portAssignment = new Int32Array(source.state.portAssignment)
  copy.state.currentRouteId = undefined
  copy.state.currentRouteNetId = undefined
  copy.state.unroutedRoutes = []
  copy.state.candidateQueue.clear()
  copy.solved = true
  return copy
}

export function jointCandidateSemanticStats(stats: Record<string, number>): Record<string, number> {
  const semantic: Record<string, number> = {}
  for (const [key, value] of Object.entries(stats)) {
    if (key.startsWith("jointCandidateScore") || key === "jointCandidateAllocationElapsedMs") continue
    semantic[key] = value
  }
  return semantic
}
