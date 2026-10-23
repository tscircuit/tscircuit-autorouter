import { TinyHyperGraphSolver, type TinyHyperGraphInitialAssignment } from "tiny-hypergraph/lib/core"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import type { DetailedRoutingConflictCosts } from "./DetailedRoutingConflictCosts"
import type { DetailedRoutingRegionPenalty } from "../../../autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9DetailedRoutingFeedback"

type PortWitness = { id: string; x: number; y: number; z: number }
type RegionWitness = { id: string; x: number; y: number; width: number; height: number; layers: number | undefined }
type RouteWitness = { id: string; net: number; start: string; end: string }
type SegmentWitness = { route: string; region: string; from: string; to: string }

/** Ordinary complete routing, kept separately from physical preload seeds. */
export type DetailedRoutingIncumbent = {
  sourceKey: string
  ports: PortWitness[]
  regions: RegionWitness[]
  routes: RouteWitness[]
  segments: SegmentWitness[]
}

function getIncumbentWitnesses(solver: TinyHyperGraphSolver): Omit<DetailedRoutingIncumbent, "sourceKey" | "segments"> {
  const ports = Array.from({ length: solver.topology.portCount }, (_, index): PortWitness => {
    const id = solver.topology.portMetadata?.[index]?.serializedPortId
    const point = { id, x: solver.topology.portX[index]!, y: solver.topology.portY[index]!, z: solver.topology.portZ[index]! }
    if (typeof id !== "string" || ![point.x, point.y, point.z].every(Number.isFinite) || !Number.isInteger(point.z)) throw new Error("Detailed incumbent requires explicit finite serialized port witnesses")
    return point
  })
  const regions = Array.from({ length: solver.topology.regionCount }, (_, index): RegionWitness => {
    const id = solver.topology.regionMetadata?.[index]?.serializedRegionId
    const region = { id, x: solver.topology.regionCenterX[index]!, y: solver.topology.regionCenterY[index]!, width: solver.topology.regionWidth[index]!, height: solver.topology.regionHeight[index]!, layers: solver.topology.regionAvailableZMask?.[index] }
    if (typeof id !== "string" || ![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.width <= 0 || region.height <= 0 || region.layers !== undefined && !Number.isInteger(region.layers)) throw new Error("Detailed incumbent requires explicit finite serialized region witnesses")
    return region
  })
  const routes = Array.from({ length: solver.problem.routeCount }, (_, index): RouteWitness => {
    const id = solver.problem.routeMetadata?.[index]?.connectionId
    const start = ports[solver.problem.routeStartPort[index]!]!.id
    const end = ports[solver.problem.routeEndPort[index]!]!.id
    const net = solver.problem.routeNet[index]!
    if (typeof id !== "string" || !Number.isInteger(net) || net < 0) throw new Error("Detailed incumbent requires explicit owned route witnesses")
    return { id, start, end, net }
  })
  for (const witnesses of [ports, regions, routes]) {
    if (new Set(witnesses.map((witness) => witness.id)).size !== witnesses.length) throw new Error("Detailed incumbent topology contains duplicate serialized witnesses")
  }
  return { ports, regions, routes }
}

export function captureDetailedRoutingIncumbent(sourceKey: string, solver: TinyHyperGraphSolver): DetailedRoutingIncumbent {
  if (!sourceKey || !solver.solved || solver.failed || solver.state.currentRouteId !== undefined || solver.state.unroutedRoutes.length !== 0) throw new Error("Only a complete successful coarse routing may seed detailed refinement")
  const witnesses = getIncumbentWitnesses(solver)
  const segments = solver.state.regionSegments.flatMap((values, regionId) => values.map(([routeId, fromPortId, toPortId]): SegmentWitness => ({
    route: witnesses.routes[routeId]!.id, region: witnesses.regions[regionId]!.id,
    from: witnesses.ports[fromPortId]!.id, to: witnesses.ports[toPortId]!.id,
  })))
  return { sourceKey, ...witnesses, segments }
}

/** Resolve exact witnesses before native connectivity/ownership validation. */
export function resolveDetailedRoutingIncumbent(incumbent: DetailedRoutingIncumbent, solver: TinyHyperGraphSolver): TinyHyperGraphInitialAssignment[] {
  const current = getIncumbentWitnesses(solver)
  for (const key of ["ports", "regions", "routes"] as const) {
    const expected = new Map(incumbent[key].map((witness) => [witness.id, JSON.stringify(witness)]))
    if (expected.size !== incumbent[key].length || current[key].length !== expected.size || current[key].some((witness) => expected.get(witness.id) !== JSON.stringify(witness))) throw new Error(`Detailed incumbent ${key} no longer match the original topology and ownership`)
  }
  const ports = new Map(current.ports.map((port, index) => [port.id, index]))
  const regions = new Map(current.regions.map((region, index) => [region.id, index]))
  const routes = new Map(current.routes.map((route, index) => [route.id, index]))
  return incumbent.segments.map((segment) => {
    const routeId = routes.get(segment.route), regionId = regions.get(segment.region)
    const fromPortId = ports.get(segment.from), toPortId = ports.get(segment.to)
    if (routeId === undefined || regionId === undefined || fromPortId === undefined || toPortId === undefined) throw new Error("Detailed incumbent lost a serialized segment witness")
    return { routeId, regionId, fromPortId, toPortId }
  })
}

/** Install a feasible incumbent before opening the finite feedback search. */
export function createDetailedRoutingAnytimeSolverClass(
  SolveClass: typeof TinyHyperGraphSolver,
  costs: DetailedRoutingConflictCosts,
  incumbent: DetailedRoutingIncumbent | undefined,
  penalties: readonly DetailedRoutingRegionPenalty[],
): typeof TinyHyperGraphSolver {
  return class DetailedConflictAnytimeSolver extends SolveClass {
        private incumbentSnapshot?: unknown
        constructor(...args: ConstructorParameters<typeof TinyHyperGraphSolver>) {
          super(...args)
          costs.install(this)
          if (incumbent) {
            const nativeInitialQueue = [...this.state.unroutedRoutes]
            const nativeInitialSuccess = this.routeSuccessCountByRouteId.slice()
            const assignments = resolveDetailedRoutingIncumbent(incumbent, this)
            const physicalAssignments = this.problem.initialAssignments
            // Do not add ordinary routes to problem.initialAssignments: the
            // stable preload reset must retain its original physical provenance.
            TinyHyperGraphSolver.prototype.resetRoutingStateForRerip.call(this)
            applyInitialAssignments({ topology: this.topology,
              problem: { ...this.problem, initialAssignments: assignments },
              state: this.state, routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
              appendSegmentToRegionCache: (region, from, to): void => this.appendSegmentToRegionCache(region, from, to),
            })
            // A native zero-length demand has no segment to replay.
            this.state.unroutedRoutes = this.state.unroutedRoutes.filter((route) => {
              if (this.problem.routeStartPort[route] !== this.problem.routeEndPort[route]) return true
              this.routeSuccessCountByRouteId[route] = 1
              return false
            })
            if (this.state.unroutedRoutes.length !== 0) throw new Error("Detailed incumbent does not contain every complete coarse route")
            this.captureBestSolvedState(this.summarizeSolvedState(this))
            this.incumbentSnapshot = this.bestSolvedStateSnapshot

            const affectedNames = new Set(penalties.map((penalty) => penalty.connectionName))
            const affected = new Set<number>()
            this.problem.routeMetadata?.forEach((metadata, route) => {
              if (affectedNames.has(metadata?.simpleRouteConnection?.name ?? metadata?.connectionId)) affected.add(route)
            })
            if (affected.size === 0) throw new Error("Detailed refinement has no owned route in its proven incumbent")
            // Recompute native pressure in this exact scene, rather than
            // importing an old score. This snapshot is an anytime feasibility
            // bound, not an assertion that its soft feedback cost is optimal.
            // Begin the original full native rerip. Only its true physical
            // preload assignments are restored by the stable reset policy.
            this.routeSuccessCountByRouteId.fill(0)
            this.resetRoutingStateForRerip()
            // A rerip shuffles its queue; this is the first cold attempt, so
            // retain the constructor's native route order and success counts.
            this.state.unroutedRoutes = nativeInitialQueue
            this.routeSuccessCountByRouteId.set(nativeInitialSuccess)
            if (this.problem.initialAssignments !== physicalAssignments) throw new Error("Detailed refinement changed physical preload assignments")
            Object.assign(this.stats, {
              detailedIncumbentInstalled: 1, detailedIncumbentRouteCount: this.problem.routeCount,
              detailedIncumbentSegmentCount: assignments.length,
              detailedIncumbentAffectedRouteCount: affected.size,
              detailedIncumbentRefinedRouteCount: this.state.unroutedRoutes.length,
              detailedIncumbentRetainedRouteCount: this.problem.routeCount - this.state.unroutedRoutes.length,
            })
          }
        }

        override tryFinalAcceptance(): void {
          const knownCompleteIncumbent = this.incumbentSnapshot !== undefined && this.bestSolvedStateSnapshot === this.incumbentSnapshot
          super.tryFinalAcceptance()
          if (knownCompleteIncumbent && this.solved && !this.failed && this.stats.acceptedBestSolutionOnTimeout) {
            this.stats.detailedIncumbentAcceptedAtNativeBudget = 1
          }
        }
  }
}
