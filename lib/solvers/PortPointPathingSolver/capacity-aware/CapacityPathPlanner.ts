import { distance } from "@tscircuit/math-utils"
import { PriorityQueue } from "lib/data-structures/PriorityQueue"
import { getTunedTotalCapacity1 } from "lib/utils/getTunedTotalCapacity1"
import { getConnectionPointZLayers } from "../hgportpointpathingsolver/get-connection-point-z-layers"
import type {
  RegionHg,
  RegionPortHg,
} from "../hgportpointpathingsolver/types"
import { createTinyRouteNetIndexer } from "../tinyhypergraph/createTinyRouteNetIndexer"
import { getRegionNetIdByRegionId } from "../tinyhypergraph/getRegionNetIdByRegionId"
import { getCapacityStateId, parseCapacityStateId } from "./state-id"
import type {
  CapacityAwarePortPointPathingSolverParams,
  CapacityPathingPlan,
  CapacityRoute,
  PortalResource,
  RegionResource,
  ViaResource,
} from "./types"

type PortalArc = {
  nextRegionId: string
  resourceId: string
}

type SearchCandidate = {
  f: number
  g: number
  stateId: string
}

const PORTAL_PRESENT_COST_FACTOR = 8
const PORTAL_HISTORY_COST_FACTOR = 4
const VIA_BASE_COST = 2
const VIA_PRESENT_COST_FACTOR = 8
const REGION_PRESENT_COST_FACTOR = 0.2
const REGION_OVER_CAPACITY_COST_FACTOR = 12

/**
 * Chooses a region/layer corridor for every route while enforcing the physical
 * lane count on each shared region edge. Exact lane positions are assigned only
 * after the corridor plan has no overflow.
 */
export class CapacityPathPlanner {
  readonly routes: CapacityRoute[]
  readonly regionById: Map<string, RegionHg>
  readonly portalResources = new Map<string, PortalResource>()
  readonly maxNegotiationPasses: number
  readonly maxIterations: number

  solved = false
  failed = false
  error: string | null = null
  progress = 0
  stats: Record<string, number> = {}

  private readonly portalArcsByState = new Map<string, PortalArc[]>()
  private readonly viaResources = new Map<string, ViaResource>()
  private readonly regionResources = new Map<string, RegionResource>()
  private readonly regionNetIdByRegionId: Map<string, number>
  private routeOrder: CapacityRoute[]
  private currentRouteIndex = 0
  private negotiationPass = 0

  constructor(
    private readonly params: CapacityAwarePortPointPathingSolverParams,
  ) {
    this.regionById = new Map(
      params.graph.regions.map((region) => [region.regionId, region]),
    )

    const getNetIndex = createTinyRouteNetIndexer()
    for (const connection of params.connections) {
      getNetIndex({
        connectionId: connection.connectionId,
        mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
      })
    }

    this.buildPortalResources(getNetIndex)
    this.buildRegionResources()
    this.regionNetIdByRegionId = getRegionNetIdByRegionId({
      params: {
        graph: params.graph,
        connections: params.connections,
        layerCount: params.layerCount,
      },
      getNetIndex,
    })

    this.routes = params.connections.map((connection) => {
      const startPoint = connection.simpleRouteConnection.pointsToConnect[0]
      const endPoint = connection.simpleRouteConnection.pointsToConnect.at(-1)!
      return {
        connection,
        netId: getNetIndex({
          connectionId: connection.connectionId,
          mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
        }),
        startZ: getConnectionPointZLayers({
          point: startPoint,
          layerCount: params.layerCount,
        }),
        endZ: new Set(
          getConnectionPointZLayers({
            point: endPoint,
            layerCount: params.layerCount,
          }),
        ),
        portalResourceIds: [],
        viaResourceIds: [],
        regionResourceIds: [],
        stateIds: [],
        straightLineDistance: distance(
          connection.startRegion.d.center,
          connection.endRegion.d.center,
        ),
      }
    })
    this.routeOrder = this.getLongestRoutesFirst()
    this.maxNegotiationPasses = Math.max(8, Math.ceil(40 * params.effort))
    this.maxIterations =
      Math.max(1, this.routes.length) * this.maxNegotiationPasses + 1
    this.stats = {
      routeCount: this.routes.length,
      regionCount: params.graph.regions.length,
      regionLayerStateCount: params.graph.regions.reduce(
        (count, region) => count + region.d.availableZ.length,
        0,
      ),
      portalResourceCount: this.portalResources.size,
      physicalPortPointCount: params.graph.ports.length,
    }
  }

  step(): void {
    if (this.solved || this.failed) return

    const route = this.routeOrder[this.currentRouteIndex]
    if (!route) {
      this.completeNegotiationPass()
      return
    }

    this.changeRouteUsage(route, -1)
    if (!this.findPath(route)) {
      this.failed = true
      this.error = `No region/layer path exists for "${route.connection.connectionId}"`
      return
    }
    this.changeRouteUsage(route, 1)
    this.currentRouteIndex++
    this.progress =
      (this.negotiationPass +
        this.currentRouteIndex / Math.max(1, this.routes.length)) /
      this.maxNegotiationPasses
  }

  getPlan(): CapacityPathingPlan {
    if (!this.solved) {
      throw new Error(
        "Cannot build a capacity pathing plan before it is solved",
      )
    }
    return {
      routes: this.routes,
      regionById: this.regionById,
      portalResources: this.portalResources,
      assignedPortByResourceAndNet: this.assignPortsByResourceAndNet(),
    }
  }

  private getLongestRoutesFirst(): CapacityRoute[] {
    return [...this.routes].sort(
      (a, b) => b.straightLineDistance - a.straightLineDistance,
    )
  }

  private buildPortalResources(
    getNetIndex: ReturnType<typeof createTinyRouteNetIndexer>,
  ): void {
    for (const port of this.params.graph.ports) {
      const regionIds = [
        port.region1.regionId,
        port.region2.regionId,
      ].sort() as [string, string]
      const resourceId = `${regionIds[0]}|${regionIds[1]}|z${port.d.z}`
      let resource = this.portalResources.get(resourceId)
      if (!resource) {
        resource = {
          id: resourceId,
          regionIds,
          z: port.d.z,
          ports: [],
          fixedPorts: new Set(),
          fixedPortByNet: new Map(),
          routeCountByNet: new Map(),
          historyCost: 0,
        }
        this.portalResources.set(resourceId, resource)

        for (const [fromRegionId, nextRegionId] of [
          [regionIds[0], regionIds[1]],
          [regionIds[1], regionIds[0]],
        ] as const) {
          const fromStateId = getCapacityStateId(fromRegionId, port.d.z)
          const arcs = this.portalArcsByState.get(fromStateId) ?? []
          arcs.push({ nextRegionId, resourceId })
          this.portalArcsByState.set(fromStateId, arcs)
        }
      }
      resource.ports.push(port)
    }

    for (const resource of this.portalResources.values()) {
      for (const port of resource.ports) {
        const fixedNetIds = port.d._preloadedFixedNetIds ?? []
        if (fixedNetIds.length > 0) resource.fixedPorts.add(port)
        for (const fixedNetId of fixedNetIds) {
          const netId = getNetIndex({
            connectionId: fixedNetId,
            mutuallyConnectedNetworkId: fixedNetId,
          })
          if (!resource.fixedPortByNet.has(netId)) {
            resource.fixedPortByNet.set(netId, port)
          }
        }
      }
    }
  }

  private buildRegionResources(): void {
    const viaDiameter = this.params.minViaPadDiameter ?? 0.3
    const obstacleMargin = this.params.obstacleMargin ?? 0.15
    const viaPitch = viaDiameter + obstacleMargin

    for (const region of this.params.graph.regions) {
      if (region.d.availableZ.length > 1) {
        const viaResource: ViaResource = {
          id: `via|${region.regionId}`,
          regionId: region.regionId,
          capacity: Math.max(
            0.01,
            (region.d.width * region.d.height) / viaPitch ** 2,
          ),
          routeCountByNet: new Map(),
        }
        this.viaResources.set(viaResource.id, viaResource)
      }

      const regionResource: RegionResource = {
        id: `region|${region.regionId}`,
        regionId: region.regionId,
        capacity: getTunedTotalCapacity1(region.d, 1, {
          viaDiameter,
          obstacleMargin,
        }),
        routeCountByNet: new Map(),
      }
      this.regionResources.set(regionResource.id, regionResource)
    }
  }

  private getPortalUsage(resource: PortalResource): number {
    let usage = resource.fixedPorts.size
    for (const netId of resource.routeCountByNet.keys()) {
      if (!resource.fixedPortByNet.has(netId)) usage++
    }
    return usage
  }

  private getPortalStepCost(
    route: CapacityRoute,
    resource: PortalResource,
  ): number {
    const currentUsage = this.getPortalUsage(resource)
    const netAlreadyUsesPortal =
      resource.fixedPortByNet.has(route.netId) ||
      resource.routeCountByNet.has(route.netId)
    const projectedUsage = currentUsage + (netAlreadyUsesPortal ? 0 : 1)
    const utilization = projectedUsage / Math.max(1, resource.ports.length)
    return (
      1 +
      PORTAL_PRESENT_COST_FACTOR * utilization ** 4 +
      PORTAL_HISTORY_COST_FACTOR * resource.historyCost
    )
  }

  private getViaStepCost(route: CapacityRoute, resource: ViaResource): number {
    if (resource.routeCountByNet.has(route.netId)) return VIA_BASE_COST
    const currentUsage = resource.routeCountByNet.size
    const projectedUsage = currentUsage + 1
    const currentCost =
      (currentUsage / resource.capacity) * (1 + currentUsage / 5)
    const projectedCost =
      (projectedUsage / resource.capacity) * (1 + projectedUsage / 5)
    return (
      VIA_BASE_COST + (projectedCost - currentCost) * VIA_PRESENT_COST_FACTOR
    )
  }

  private getRegionStepCost(route: CapacityRoute, region: RegionHg): number {
    if (region.d._containsTarget) return 0
    const resource = this.regionResources.get(`region|${region.regionId}`)!
    if (resource.routeCountByNet.has(route.netId)) return 0
    const capacity = Math.max(1, resource.capacity)
    const projectedUsage = resource.routeCountByNet.size + 1
    const utilization = projectedUsage / capacity
    const overflow = Math.max(0, projectedUsage - capacity)
    return (
      utilization * REGION_PRESENT_COST_FACTOR +
      (overflow / capacity) ** 2 * REGION_OVER_CAPACITY_COST_FACTOR
    )
  }

  private isRegionAllowed(route: CapacityRoute, regionId: string): boolean {
    const reservedNetId = this.regionNetIdByRegionId.get(regionId)
    return reservedNetId === undefined || reservedNetId === route.netId
  }

  private findPath(route: CapacityRoute): boolean {
    const candidates = new PriorityQueue<SearchCandidate>([], 500_000)
    const bestG = new Map<string, number>()
    const previous = new Map<
      string,
      {
        previousStateId: string
        portalResourceId?: string
        viaResourceId?: string
      }
    >()

    for (const z of route.startZ) {
      if (!route.connection.startRegion.d.availableZ.includes(z)) continue
      const startStateId = getCapacityStateId(
        route.connection.startRegion.regionId,
        z,
      )
      bestG.set(startStateId, 0)
      candidates.enqueue({ f: 0, g: 0, stateId: startStateId })
    }

    let solvedStateId: string | undefined
    while (!candidates.isEmpty()) {
      const candidate = candidates.dequeue()!
      if (candidate.g !== bestG.get(candidate.stateId)) continue
      const { regionId, z } = parseCapacityStateId(candidate.stateId)
      const region = this.regionById.get(regionId)!

      if (
        regionId === route.connection.endRegion.regionId &&
        route.endZ.has(z)
      ) {
        solvedStateId = candidate.stateId
        break
      }

      const viaResource = this.viaResources.get(`via|${regionId}`)
      if (viaResource) {
        for (const nextZ of region.d.availableZ) {
          if (nextZ === z) continue
          const nextStateId = getCapacityStateId(regionId, nextZ)
          const nextG = candidate.g + this.getViaStepCost(route, viaResource)
          if (nextG >= (bestG.get(nextStateId) ?? Number.POSITIVE_INFINITY)) {
            continue
          }
          bestG.set(nextStateId, nextG)
          previous.set(nextStateId, {
            previousStateId: candidate.stateId,
            viaResourceId: viaResource.id,
          })
          candidates.enqueue({
            f:
              nextG +
              distance(region.d.center, route.connection.endRegion.d.center),
            g: nextG,
            stateId: nextStateId,
          })
        }
      }

      for (const arc of this.portalArcsByState.get(candidate.stateId) ?? []) {
        if (!this.isRegionAllowed(route, arc.nextRegionId)) continue
        const nextRegion = this.regionById.get(arc.nextRegionId)!
        const nextStateId = getCapacityStateId(arc.nextRegionId, z)
        const portalResource = this.portalResources.get(arc.resourceId)!
        const nextG =
          candidate.g +
          distance(region.d.center, nextRegion.d.center) +
          this.getPortalStepCost(route, portalResource) +
          this.getRegionStepCost(route, nextRegion)
        if (nextG >= (bestG.get(nextStateId) ?? Number.POSITIVE_INFINITY)) {
          continue
        }
        bestG.set(nextStateId, nextG)
        previous.set(nextStateId, {
          previousStateId: candidate.stateId,
          portalResourceId: portalResource.id,
        })
        candidates.enqueue({
          f:
            nextG +
            distance(nextRegion.d.center, route.connection.endRegion.d.center),
          g: nextG,
          stateId: nextStateId,
        })
      }
    }

    if (!solvedStateId) return false

    const stateIds = [solvedStateId]
    const portalResourceIds: string[] = []
    const viaResourceIds: string[] = []
    let currentStateId = solvedStateId
    while (previous.has(currentStateId)) {
      const step = previous.get(currentStateId)!
      if (step.portalResourceId) portalResourceIds.push(step.portalResourceId)
      if (step.viaResourceId) viaResourceIds.push(step.viaResourceId)
      currentStateId = step.previousStateId
      stateIds.push(currentStateId)
    }

    route.stateIds = stateIds.reverse()
    route.portalResourceIds = portalResourceIds.reverse()
    route.viaResourceIds = viaResourceIds.reverse()
    route.regionResourceIds = [
      ...new Set(
        route.stateIds.map(
          (id) => `region|${parseCapacityStateId(id).regionId}`,
        ),
      ),
    ]
    return true
  }

  private changeRouteUsage(route: CapacityRoute, delta: 1 | -1): void {
    for (const resourceId of new Set(route.portalResourceIds)) {
      this.changeNetUsage(
        this.portalResources.get(resourceId)!.routeCountByNet,
        route.netId,
        delta,
      )
    }
    for (const resourceId of new Set(route.viaResourceIds)) {
      this.changeNetUsage(
        this.viaResources.get(resourceId)!.routeCountByNet,
        route.netId,
        delta,
      )
    }
    for (const resourceId of new Set(route.regionResourceIds)) {
      this.changeNetUsage(
        this.regionResources.get(resourceId)!.routeCountByNet,
        route.netId,
        delta,
      )
    }
  }

  private changeNetUsage(
    usageByNet: Map<number, number>,
    netId: number,
    delta: 1 | -1,
  ): void {
    const nextCount = (usageByNet.get(netId) ?? 0) + delta
    if (nextCount <= 0) usageByNet.delete(netId)
    else usageByNet.set(netId, nextCount)
  }

  private completeNegotiationPass(): void {
    const overusedResources = [...this.portalResources.values()].filter(
      (resource) => this.getPortalUsage(resource) > resource.ports.length,
    )
    const totalOverflow = overusedResources.reduce(
      (sum, resource) =>
        sum + this.getPortalUsage(resource) - resource.ports.length,
      0,
    )
    this.stats = {
      ...this.stats,
      negotiationPasses: this.negotiationPass + 1,
      overusedPortalCount: overusedResources.length,
      totalPortalOverflow: totalOverflow,
    }

    if (overusedResources.length === 0) {
      this.solved = true
      this.progress = 1
      return
    }

    this.negotiationPass++
    if (this.negotiationPass >= this.maxNegotiationPasses) {
      this.failed = true
      this.error = `Could not eliminate ${totalOverflow} portal overflow after ${this.maxNegotiationPasses} passes`
      return
    }

    const overusedResourceIds = new Set(
      overusedResources.map((resource) => resource.id),
    )
    for (const resource of overusedResources) {
      resource.historyCost +=
        (this.getPortalUsage(resource) - resource.ports.length) /
        resource.ports.length
    }
    this.routeOrder = [...this.routes].sort((a, b) => {
      const aConflicts = a.portalResourceIds.filter((resourceId) =>
        overusedResourceIds.has(resourceId),
      ).length
      const bConflicts = b.portalResourceIds.filter((resourceId) =>
        overusedResourceIds.has(resourceId),
      ).length
      return (
        bConflicts - aConflicts ||
        b.straightLineDistance - a.straightLineDistance
      )
    })
    this.currentRouteIndex = 0
  }

  private assignPortsByResourceAndNet(): Map<string, RegionPortHg> {
    const assignedPortByResourceAndNet = new Map<string, RegionPortHg>()
    for (const resource of this.portalResources.values()) {
      for (const [netId, port] of resource.fixedPortByNet) {
        assignedPortByResourceAndNet.set(`${resource.id}|net${netId}`, port)
      }

      const availablePorts = resource.ports
        .filter((port) => !resource.fixedPorts.has(port))
        .sort((a, b) => a.d.x - b.d.x || a.d.y - b.d.y)
      const unassignedNetIds = [...resource.routeCountByNet.keys()]
        .filter((netId) => !resource.fixedPortByNet.has(netId))
        .sort((a, b) => a - b)

      if (unassignedNetIds.length > availablePorts.length) {
        throw new Error(
          `${unassignedNetIds.length} nets need ${availablePorts.length} available lanes on "${resource.id}"`,
        )
      }
      for (let index = 0; index < unassignedNetIds.length; index++) {
        assignedPortByResourceAndNet.set(
          `${resource.id}|net${unassignedNetIds[index]}`,
          availablePorts[index]!,
        )
      }
    }
    return assignedPortByResourceAndNet
  }
}
