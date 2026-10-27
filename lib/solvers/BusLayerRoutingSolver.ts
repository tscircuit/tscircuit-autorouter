import {
  FindClearancePathSolver,
  NegotiateTraceClearanceSolver,
} from "@tscircuit/repair04"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getPipeline9NetByConnectionName } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9NetByConnectionName"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { BaseSolver } from "./BaseSolver"

type BusLayerRoutingInput = {
  srj: SimpleRouteJson
  hdRoutes: HighDensityRoute[]
  effort?: number
}

/**
 * Negotiate legal-layer paths before timing work. Fixed pads and preloaded
 * copper stay hard obstacles; generated routes may move to free a blocked exit.
 */
export class BusLayerRoutingSolver extends BaseSolver {
  private readonly allowedZByConnectionName = new Map<
    string,
    ReadonlySet<number>
  >()
  private readonly configuredSearches = new WeakSet<FindClearancePathSolver>()
  private readonly negotiation?: NegotiateTraceClearanceSolver
  private output: HighDensityRoute[]

  constructor(private readonly input: BusLayerRoutingInput) {
    super()
    this.output = input.hdRoutes
    const buses = input.srj.buses?.filter(
      (bus) => bus.allowedLayers !== undefined,
    )
    if (buses?.length) {
      const connMap = getConnectivityMapFromSimpleRouteJson(input.srj)
      const netByConnectionName = getPipeline9NetByConnectionName(
        input.hdRoutes,
        connMap,
      )
      const allowedByNet = new Map<string, Set<number>>()
      for (const bus of buses) {
        const busLayers = new Set(bus.allowedLayers)
        const allowed = new Set(
          Array.from(
            { length: input.srj.layerCount },
            (_, z): number => z,
          ).filter((z) =>
            busLayers.has(mapZToLayerName(z, input.srj.layerCount)),
          ),
        )
        for (const name of bus.connectionNames) {
          const net = connMap.getNetConnectedToId(name)
          if (net === undefined) continue
          const previous = allowedByNet.get(net)
          allowedByNet.set(
            net,
            previous
              ? new Set([...previous].filter((z) => allowed.has(z)))
              : new Set(allowed),
          )
        }
      }
      for (const route of input.hdRoutes) {
        const net = netByConnectionName.get(route.connectionName)
        const allowed = net === undefined ? undefined : allowedByNet.get(net)
        if (allowed !== undefined)
          this.allowedZByConnectionName.set(route.connectionName, allowed)
      }
    }

    const dirtyRouteIndices = this.getViolatingRouteIndices(input.hdRoutes)
    this.stats = {
      busLayerViolationsBefore: dirtyRouteIndices.length,
      busLayerViolationsAfter: dirtyRouteIndices.length,
      accepted: false,
      pathSearchCalls: 0,
      pathSearchNodes: 0,
      unresolvedSpanCount: 0,
    }
    if (dirtyRouteIndices.length === 0) {
      this.solved = true
      this.progress = 1
      return
    }

    const effort = input.effort ?? 1
    this.negotiation = new NegotiateTraceClearanceSolver({
      srj: input.srj as ConstructorParameters<
        typeof NegotiateTraceClearanceSolver
      >[0]["srj"],
      routes: input.hdRoutes,
      bounds: input.srj.bounds,
      dirtyRouteIndices,
      isLocked: (routeIndex, pointIndex): boolean =>
        pointIndex === 0 ||
        pointIndex === input.hdRoutes[routeIndex]!.route.length - 1,
      allowLayerChanges: true,
      traceClearance: input.srj.minTraceToPadEdgeClearance ?? 0.1,
      viaClearance: input.srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
      viaHoleDiameter: getViaDimensions(input.srj).holeDiameter,
      maxPathSearchNodes: Math.ceil(10_000_000 * effort),
      maxPathSearchNodesPerCall: Math.ceil(200_000 * effort),
      maxPathSearchCalls: Math.ceil(500 * effort),
      pathHeuristicWeight: 1.2,
      searchDirectionCount: 1,
    })
    this.activeSubSolver = this.negotiation
    this.MAX_ITERATIONS = this.negotiation.MAX_ITERATIONS + 1
  }

  private getViolatingRouteIndices(routes: HighDensityRoute[]): number[] {
    return routes.flatMap((route, index): number[] => {
      const allowed = this.allowedZByConnectionName.get(route.connectionName)
      return allowed && route.route.some((point) => !allowed.has(point.z))
        ? [index]
        : []
    })
  }

  override _step(): void {
    const negotiation = this.negotiation!
    const search = negotiation.activeSubSolver
    // Negotiation exposes each path search before its first step. Add the
    // connection's layer rule to its existing congestion cost, including when
    // an initially legal blocker is ripped up and searched again.
    if (
      search instanceof FindClearancePathSolver &&
      !this.configuredSearches.has(search)
    ) {
      const route = search.input.routes[search.input.routeIndex]!
      const allowed = this.allowedZByConnectionName.get(route.connectionName)
      const congestionCost = search.input.getAdditionalEdgeCost!
      if (allowed) {
        search.input.getAdditionalEdgeCost = (a, b): number =>
          allowed.has(a.z) && allowed.has(b.z) ? congestionCost(a, b) : Infinity
      }
      this.configuredSearches.add(search)
    }
    negotiation.step()
    this.progress = negotiation.progress
    Object.assign(this.stats, negotiation.stats)
    this.MAX_ITERATIONS = Math.max(
      this.MAX_ITERATIONS,
      negotiation.MAX_ITERATIONS + 1,
    )
    if (negotiation.failed) {
      this.failed = true
      this.error = negotiation.error
      return
    }
    if (!negotiation.solved) return

    const candidate = negotiation.getOutput()
    const remaining = this.getViolatingRouteIndices(candidate.routes).length
    // Commit a complete negotiated routing atomically. A bounded search may
    // retain unresolved spans; expose that result without turning a bus rule
    // into a new runtime exception or replacing good copper with search state.
    if (candidate.unresolvedSpanCount === 0 && remaining === 0) {
      this.output = candidate.routes
      this.stats.accepted = true
    }
    this.stats.busLayerViolationsAfter = this.getViolatingRouteIndices(
      this.output,
    ).length
    this.stats.candidateBusLayerViolations = remaining
    this.solved = true
    this.progress = 1
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved)
      throw new Error("Bus layer routing output requested before completion")
    return this.output
  }

  override visualize(): GraphicsObject {
    return convertSrjToGraphicsObject({
      ...this.input.srj,
      traces: [
        ...(this.input.srj.traces ?? []),
        ...this.output.map((route, index) => ({
          type: "pcb_trace" as const,
          pcb_trace_id: `bus-route-${index}`,
          connection_name: route.rootConnectionName ?? route.connectionName,
          route: convertHdRouteToSimplifiedRoute(
            route,
            this.input.srj.layerCount,
          ),
        })),
      ],
    })
  }
}
