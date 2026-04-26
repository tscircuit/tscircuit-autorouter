import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { InputNodeWithPortPoints } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import type { CapacityMeshNodeId } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import type { HgPortPointPathingSolverParams } from "../hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "./TinyHypergraphPortPointPathingSolver"

type SerializedRegion = {
  regionId: string
  pointIds: string[]
  d: any
}

type PortData = {
  portId: string
  x: number
  y: number
  z: number
  distToCentermostPortOnZ: number
}

type SerializedPort = {
  portId: string
  region1Id: string
  region2Id: string
  d: PortData
}

type SerializedConnection = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  startRegionId: string
  endRegionId: string
  simpleRouteConnection?: any
}

type SerializedHgPortPointPathingSolverParams = Omit<
  HgPortPointPathingSolverParams,
  "graph" | "connections"
> & {
  format?: string
  graph: {
    regions: SerializedRegion[]
    ports: SerializedPort[]
  }
  connections: SerializedConnection[]
}

type NormalizedRegion = SerializedRegion & {
  ports: SerializedPort[]
}

type NormalizedConnection = SerializedConnection & {
  rootConnectionName: string
  connectionName: string
}

type NormalizedData = {
  regions: NormalizedRegion[]
  ports: SerializedPort[]
  connections: NormalizedConnection[]
}

type TinyRouteBfsState = {
  portId: number
  nextRegionId: number
  prev: TinyRouteBfsState | null
}

type ActiveTinyRouteBfs = {
  solver: any
  routeId: number
  routeLabel: string
  startPortId: number
  goalPortId: number
  goalRegionIds: Set<number>
  queue: TinyRouteBfsState[]
  seen: Set<string>
  lastExpandedPortIds: number[]
  approved: boolean
  blockedPortIds: Set<number>
}

type ConnectionNameSource = {
  connectionId: string
  mutuallyConnectedNetworkId?: string
  simpleRouteConnection?: { rootConnectionName?: string; name?: string }
}

const getConnectionNames = (connection: ConnectionNameSource) => ({
  rootConnectionName:
    connection.simpleRouteConnection?.rootConnectionName ??
    connection.mutuallyConnectedNetworkId ??
    connection.connectionId,
  connectionName:
    connection.simpleRouteConnection?.name ?? connection.connectionId,
})

type RuntimePortInput = {
  d: PortData
  region1: { regionId: string }
  region2: { regionId: string }
}

const serializePort = (port: RuntimePortInput): SerializedPort => ({
  portId: port.d.portId,
  region1Id: port.region1.regionId,
  region2Id: port.region2.regionId,
  d: {
    portId: port.d.portId,
    x: port.d.x,
    y: port.d.y,
    z: port.d.z,
    distToCentermostPortOnZ: port.d.distToCentermostPortOnZ,
  },
})

const isSerializedParams = (
  params:
    | HgPortPointPathingSolverParams
    | SerializedHgPortPointPathingSolverParams,
): params is SerializedHgPortPointPathingSolverParams =>
  Boolean(
    (params as SerializedHgPortPointPathingSolverParams).graph?.ports?.[0]
      ?.region1Id,
  )

const normalizeParams = (
  params:
    | HgPortPointPathingSolverParams
    | SerializedHgPortPointPathingSolverParams,
): NormalizedData => {
  if (isSerializedParams(params)) {
    const regionMap = new Map<string, NormalizedRegion>()
    for (const region of params.graph.regions) {
      regionMap.set(region.regionId, { ...region, ports: [] })
    }

    const ports = params.graph.ports.map((port) => ({ ...port }))
    for (const port of ports) {
      regionMap.get(port.region1Id)?.ports.push(port)
      regionMap.get(port.region2Id)?.ports.push(port)
    }

    return {
      regions: [...regionMap.values()],
      ports,
      connections: params.connections.map((connection) => ({
        ...connection,
        ...getConnectionNames(connection),
      })),
    }
  }

  const regions = params.graph.regions.map(
    (region): NormalizedRegion => ({
      regionId: region.regionId,
      pointIds: region.ports.map((port) => port.d.portId),
      d: region.d,
      ports: region.ports.map(serializePort),
    }),
  )

  const portMap = new Map<string, SerializedPort>()
  for (const region of regions) {
    for (const port of region.ports) {
      portMap.set(port.portId, port)
    }
  }

  return {
    regions,
    ports: [...portMap.values()],
    connections: params.connections.map((connection) => ({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
      startRegionId: connection.startRegion.regionId,
      endRegionId: connection.endRegion.regionId,
      simpleRouteConnection: connection.simpleRouteConnection,
      ...getConnectionNames(connection),
    })),
  }
}

const createRuntimeParams = (
  params:
    | HgPortPointPathingSolverParams
    | SerializedHgPortPointPathingSolverParams,
): HgPortPointPathingSolverParams => {
  if (!isSerializedParams(params)) {
    return params
  }

  const normalized = normalizeParams(params)
  const regionMap = new Map<string, any>()

  for (const region of normalized.regions) {
    regionMap.set(region.regionId, {
      regionId: region.regionId,
      d: region.d,
      ports: [],
    })
  }

  const graphPorts: any[] = []
  for (const port of normalized.ports) {
    const region1 = regionMap.get(port.region1Id)
    const region2 = regionMap.get(port.region2Id)
    if (!region1 || !region2) continue

    const runtimePort = {
      portId: port.portId,
      region1,
      region2,
      d: {
        ...port.d,
        regions: [region1, region2],
      },
    }
    graphPorts.push(runtimePort)
    region1.ports.push(runtimePort)
    region2.ports.push(runtimePort)
  }

  return {
    graph: {
      regions: [...regionMap.values()],
      ports: graphPorts,
    } as HgPortPointPathingSolverParams["graph"],
    connections: normalized.connections.map((connection) => ({
      connectionId: connection.connectionId,
      mutuallyConnectedNetworkId: connection.mutuallyConnectedNetworkId,
      startRegion: regionMap.get(connection.startRegionId),
      endRegion: regionMap.get(connection.endRegionId),
      simpleRouteConnection: connection.simpleRouteConnection,
    })) as HgPortPointPathingSolverParams["connections"],
    colorMap: params.colorMap,
    inputSolvedRoutes: params.inputSolvedRoutes,
    layerCount: params.layerCount,
    effort: params.effort,
    minViaPadDiameter: params.minViaPadDiameter,
    flags: params.flags,
    weights: params.weights,
    opts: params.opts,
  }
}

export class TinyHypergraphBfsPortPointPathingSolver extends BaseSolver {
  private readonly originalParams:
    | HgPortPointPathingSolverParams
    | SerializedHgPortPointPathingSolverParams
  private readonly wrappedSolver: TinyHypergraphPortPointPathingSolver
  private readonly originalRegionById = new Map<
    CapacityMeshNodeId,
    NormalizedRegion
  >()
  private activeRouteBfs: ActiveTinyRouteBfs | null = null
  private displayedRouteBfs: ActiveTinyRouteBfs | null = null

  constructor(
    params:
      | HgPortPointPathingSolverParams
      | SerializedHgPortPointPathingSolverParams,
  ) {
    super()
    this.originalParams = params
    this.wrappedSolver = new TinyHypergraphPortPointPathingSolver(
      createRuntimeParams(params),
    )
    this.MAX_ITERATIONS = this.wrappedSolver.MAX_ITERATIONS

    for (const region of normalizeParams(params).regions) {
      this.originalRegionById.set(region.d.capacityMeshNodeId, region)
    }
  }

  getSolverName(): string {
    return "TinyHypergraphBfsPortPointPathingSolver"
  }

  override _step() {
    this.displayedRouteBfs = null
    const activeTinySolver = this.getActiveTinySolver()
    if (activeTinySolver) {
      const { activeRouteBfs, isNewConnectionStart } =
        this.getOrCreateActiveRouteBfs(activeTinySolver)
      if (activeRouteBfs && isNewConnectionStart) {
        this.runRouteBfsToCompletion(activeRouteBfs)
        this.displayedRouteBfs = activeRouteBfs
        this.activeSubSolver = activeTinySolver
        this.progress = this.wrappedSolver.progress
        this.stats = {
          ...(this.wrappedSolver.stats ?? {}),
          bfsRouteId: activeRouteBfs.routeId,
          bfsRouteLabel: activeRouteBfs.routeLabel,
          bfsQueueSize: activeRouteBfs.queue.length,
          bfsApproved: activeRouteBfs.approved,
          bfsLastExpandedPortCount: activeRouteBfs.lastExpandedPortIds.length,
        }
        return
      }
    } else {
      this.activeRouteBfs = null
    }

    this.wrappedSolver.step()
    this.solved = this.wrappedSolver.solved
    this.failed = this.wrappedSolver.failed
    this.error = this.wrappedSolver.error
    this.progress = this.wrappedSolver.progress
    this.stats = this.wrappedSolver.stats
    this.activeSubSolver = this.wrappedSolver.activeSubSolver ?? null
  }

  private getPipelineSolver(): any {
    return (this.wrappedSolver as any).tinyPipelineSolver
  }

  private isTinySolver(candidate: any): boolean {
    return Boolean(
      candidate?.topology &&
        candidate?.problem &&
        candidate?.state &&
        typeof candidate.getStartingNextRegionId === "function",
    )
  }

  private findTinySolver(candidate: any): any | null {
    if (!candidate) return null
    if (this.isTinySolver(candidate)) return candidate
    return (
      this.findTinySolver(candidate.activeSubSolver) ??
      this.findTinySolver(candidate.sectionSolver) ??
      this.findTinySolver(candidate.baselineSolver) ??
      this.findTinySolver(candidate.optimizedSolver) ??
      null
    )
  }

  private getActiveTinySolver(): any | null {
    const pipelineSolver = this.getPipelineSolver()
    return (
      this.findTinySolver(this.wrappedSolver.activeSubSolver) ??
      this.findTinySolver(pipelineSolver?.activeSubSolver) ??
      this.findTinySolver(pipelineSolver?.getSolver?.("solveGraph")) ??
      this.findTinySolver(pipelineSolver?.getInitialVisualizationSolver?.()) ??
      null
    )
  }

  private isPortReservedForDifferentNetForRoute(
    solver: any,
    portId: number,
    routeNetId: number,
  ) {
    const reservedNetIds = solver.problemSetup?.portEndpointNetIds?.[portId]
    if (!reservedNetIds) return false
    for (const netId of reservedNetIds) {
      if (netId !== routeNetId) return true
    }
    return false
  }

  private isRegionReservedForDifferentNetForRoute(
    solver: any,
    regionId: number,
    routeNetId: number,
  ) {
    const reservedNetId = solver.problem.regionNetId[regionId]
    return reservedNetId !== -1 && reservedNetId !== routeNetId
  }

  private getOrCreateActiveRouteBfs(solver: any): {
    activeRouteBfs: ActiveTinyRouteBfs | null
    isNewConnectionStart: boolean
  } {
    if (solver.state.currentRouteId !== undefined) {
      if (
        this.activeRouteBfs &&
        this.activeRouteBfs.solver === solver &&
        this.activeRouteBfs.routeId === solver.state.currentRouteId
      ) {
        return {
          activeRouteBfs: this.activeRouteBfs,
          isNewConnectionStart: false,
        }
      }
      return { activeRouteBfs: null, isNewConnectionStart: false }
    }

    const nextRouteId = solver.state.unroutedRoutes[0]
    if (nextRouteId === undefined) {
      this.activeRouteBfs = null
      return { activeRouteBfs: null, isNewConnectionStart: false }
    }

    if (
      this.activeRouteBfs &&
      this.activeRouteBfs.solver === solver &&
      this.activeRouteBfs.routeId === nextRouteId
    ) {
      return {
        activeRouteBfs: this.activeRouteBfs,
        isNewConnectionStart: false,
      }
    }

    const startingPortId = solver.problem.routeStartPort[nextRouteId]
    const routeNetId = solver.problem.routeNet[nextRouteId]
    const routeMetadata = solver.problem.routeMetadata?.[nextRouteId]
    const routeRootConnectionName = this.getRouteRootConnectionName(
      routeMetadata,
      nextRouteId,
    )
    const blockedPortIds = this.getBlockedPortIdsForRoute(
      solver,
      routeRootConnectionName,
    )
    if (blockedPortIds.has(startingPortId)) {
      this.failed = true
      this.error = `BFS failed for route ${nextRouteId}: start port ${startingPortId} is blocked by a solved route`
      return { activeRouteBfs: null, isNewConnectionStart: false }
    }
    const startingIncidentRegions =
      solver.topology.incidentPortRegion[startingPortId] ?? []
    const goalPortId = solver.problem.routeEndPort[nextRouteId]
    if (blockedPortIds.has(goalPortId)) {
      this.failed = true
      this.error = `BFS failed for route ${nextRouteId}: goal port ${goalPortId} is blocked by a solved route`
      return { activeRouteBfs: null, isNewConnectionStart: false }
    }
    const goalRegionIds = new Set<number>(
      (solver.topology.incidentPortRegion[goalPortId] ?? []).filter(
        (regionId: number) =>
          !this.isRegionReservedForDifferentNetForRoute(
            solver,
            regionId,
            routeNetId,
          ),
      ),
    )

    const startingStates = startingIncidentRegions
      .filter((regionId: number) => {
        const reservedNetId = solver.problem.regionNetId[regionId]
        return reservedNetId === -1 || reservedNetId === routeNetId
      })
      .map(
        (regionId: number): TinyRouteBfsState => ({
          portId: startingPortId,
          nextRegionId: regionId,
          prev: null,
        }),
      )

    if (startingStates.length === 0) {
      this.failed = true
      this.error = `BFS failed for route ${nextRouteId}: start port ${startingPortId} has no available region`
      return { activeRouteBfs: null, isNewConnectionStart: false }
    }

    this.activeRouteBfs = {
      solver,
      routeId: nextRouteId,
      routeLabel:
        routeMetadata?.simpleRouteConnection?.name ??
        routeMetadata?.connectionId ??
        `route-${nextRouteId}`,
      startPortId: startingPortId,
      goalPortId,
      goalRegionIds,
      queue: startingStates,
      seen: new Set(
        startingStates.map(
          (state: TinyRouteBfsState) => `${state.portId}:${state.nextRegionId}`,
        ),
      ),
      lastExpandedPortIds: [startingPortId],
      approved:
        startingPortId === goalPortId ||
        startingStates.some((state: TinyRouteBfsState) =>
          goalRegionIds.has(state.nextRegionId),
        ),
      blockedPortIds,
    }

    if (this.activeRouteBfs.approved) {
      this.activeRouteBfs.lastExpandedPortIds =
        startingPortId === goalPortId
          ? [startingPortId]
          : [startingPortId, goalPortId]
    }

    return {
      activeRouteBfs: this.activeRouteBfs,
      isNewConnectionStart: true,
    }
  }

  private runRouteBfsToCompletion(activeRouteBfs: ActiveTinyRouteBfs) {
    while (!this.failed && activeRouteBfs.queue.length > 0) {
      this.advanceRouteBfs(activeRouteBfs)
    }
  }

  private advanceRouteBfs(activeRouteBfs: ActiveTinyRouteBfs) {
    const current = activeRouteBfs.queue.shift()
    if (!current) {
      this.failed = true
      this.error = `BFS failed for ${activeRouteBfs.routeLabel}: ran out of candidate ports before reaching the goal side`
      this.logBfsFailure(activeRouteBfs, "empty_queue")
      return
    }

    const currentPath = this.reconstructPortPath(current)
    activeRouteBfs.lastExpandedPortIds = currentPath

    if (activeRouteBfs.goalRegionIds.has(current.nextRegionId)) {
      if (!activeRouteBfs.approved) {
        activeRouteBfs.lastExpandedPortIds = [
          ...currentPath,
          activeRouteBfs.goalPortId,
        ]
        activeRouteBfs.approved = true
      }
    }

    const { solver } = activeRouteBfs
    const routeNetId = solver.problem.routeNet[activeRouteBfs.routeId]
    const neighbors =
      solver.topology.regionIncidentPorts[current.nextRegionId] ?? []
    for (const neighborPortId of neighbors) {
      const assignedNetId = solver.state.portAssignment[neighborPortId]
      if (
        this.isPortReservedForDifferentNetForRoute(
          solver,
          neighborPortId,
          routeNetId,
        )
      ) {
        continue
      }
      if (neighborPortId === current.portId) continue
      if (activeRouteBfs.blockedPortIds.has(neighborPortId)) continue

      if (neighborPortId === activeRouteBfs.goalPortId) {
        if (!activeRouteBfs.approved) {
          activeRouteBfs.lastExpandedPortIds = [
            ...this.reconstructPortPath(current),
            neighborPortId,
          ]
          activeRouteBfs.approved = true
        }
      }

      if (
        assignedNetId !== -1 &&
        assignedNetId !== solver.problem.routeNet[activeRouteBfs.routeId]
      ) {
        continue
      }
      if (solver.problem.portSectionMask[neighborPortId] === 0) continue

      const incidentRegions =
        solver.topology.incidentPortRegion[neighborPortId] ?? []
      const nextRegionId =
        incidentRegions[0] === current.nextRegionId
          ? incidentRegions[1]
          : incidentRegions[0]

      if (
        nextRegionId === undefined ||
        this.isRegionReservedForDifferentNetForRoute(
          solver,
          nextRegionId,
          routeNetId,
        )
      ) {
        continue
      }

      const stateKey = `${neighborPortId}:${nextRegionId}`
      if (activeRouteBfs.seen.has(stateKey)) continue
      activeRouteBfs.seen.add(stateKey)
      activeRouteBfs.queue.push({
        portId: neighborPortId,
        nextRegionId,
        prev: current,
      })
    }

    if (activeRouteBfs.queue.length === 0 && !activeRouteBfs.approved) {
      this.failed = true
      this.error = `BFS failed for ${activeRouteBfs.routeLabel}: ran out of candidate ports before reaching the goal side`
      this.logBfsFailure(activeRouteBfs, "frontier_exhausted")
    }
  }

  private logBfsFailure(activeRouteBfs: ActiveTinyRouteBfs, reason: string) {
    const { solver } = activeRouteBfs
    const routeNetId = solver.problem.routeNet[activeRouteBfs.routeId]
    console.log("[TinyHypergraphBfs] failure", {
      reason,
      routeId: activeRouteBfs.routeId,
      routeLabel: activeRouteBfs.routeLabel,
      routeNetId,
      startPortId: activeRouteBfs.startPortId,
      goalPortId: activeRouteBfs.goalPortId,
      goalRegionIds: [...activeRouteBfs.goalRegionIds],
      queueSize: activeRouteBfs.queue.length,
      seenCount: activeRouteBfs.seen.size,
      lastExpandedPortIds: activeRouteBfs.lastExpandedPortIds,
      startIncidentRegions:
        solver.topology.incidentPortRegion[activeRouteBfs.startPortId] ?? [],
      goalIncidentRegions:
        solver.topology.incidentPortRegion[activeRouteBfs.goalPortId] ?? [],
    })
  }

  private reconstructPortPath(state: TinyRouteBfsState): number[] {
    const portIds: number[] = []
    let cursor: TinyRouteBfsState | null = state
    while (cursor) {
      portIds.unshift(cursor.portId)
      cursor = cursor.prev
    }
    return portIds
  }

  private getRegionCenter(solver: any, regionId: number) {
    const regionMetadata = solver.topology.regionMetadata?.[regionId]
    const originalRegion = regionMetadata?.capacityMeshNodeId
      ? this.originalRegionById.get(regionMetadata.capacityMeshNodeId)
      : null

    if (originalRegion?.d?.center) return originalRegion.d.center
    if (regionMetadata?.center) return regionMetadata.center

    if (regionMetadata?.bounds) {
      return {
        x: (regionMetadata.bounds.minX + regionMetadata.bounds.maxX) / 2,
        y: (regionMetadata.bounds.minY + regionMetadata.bounds.maxY) / 2,
      }
    }

    return null
  }

  private getPortPoint(solver: any, portId: number) {
    const portMetadata = solver.topology.portMetadata?.[portId]
    if (
      typeof portMetadata?.x === "number" &&
      typeof portMetadata?.y === "number"
    ) {
      return { x: portMetadata.x, y: portMetadata.y }
    }
    return null
  }

  private getRegionRect(
    solver: any,
    regionId: number,
    opts: { fill: string; stroke: string; label: string },
  ) {
    const regionMetadata = solver.topology.regionMetadata?.[regionId]
    const originalRegion = regionMetadata?.capacityMeshNodeId
      ? this.originalRegionById.get(regionMetadata.capacityMeshNodeId)
      : null
    const center = this.getRegionCenter(solver, regionId)
    if (!center) return null

    return {
      center,
      width:
        originalRegion?.d?.width ??
        (regionMetadata?.bounds
          ? regionMetadata.bounds.maxX - regionMetadata.bounds.minX
          : 0.3),
      height:
        originalRegion?.d?.height ??
        (regionMetadata?.bounds
          ? regionMetadata.bounds.maxY - regionMetadata.bounds.minY
          : 0.3),
      fill: opts.fill,
      stroke: opts.stroke,
      label: opts.label,
    }
  }

  private getCandidateReachability(
    solver: any,
    activeRouteBfs: ActiveTinyRouteBfs,
  ) {
    const routeNet = solver.problem.routeNet[activeRouteBfs.routeId]
    const blockedPortIds = activeRouteBfs.blockedPortIds
    const candidateRegionIds = new Set<number>()
    const candidatePortIds = new Set<number>()
    const reachableRegionIds = new Set<number>()
    const reachablePortIds = new Set<number>()

    for (
      let regionId = 0;
      regionId < (solver.topology.regionIncidentPorts?.length ?? 0);
      regionId++
    ) {
      if (
        !this.isRegionReservedForDifferentNetForRoute(
          solver,
          regionId,
          routeNet,
        )
      ) {
        candidateRegionIds.add(regionId)
      }
    }

    for (
      let portId = 0;
      portId < (solver.topology.incidentPortRegion?.length ?? 0);
      portId++
    ) {
      const assignedNetId = solver.state.portAssignment[portId]
      if (
        !this.isPortReservedForDifferentNetForRoute(solver, portId, routeNet) &&
        (assignedNetId === -1 || assignedNetId === routeNet) &&
        solver.problem.portSectionMask[portId] !== 0 &&
        !blockedPortIds.has(portId)
      ) {
        candidatePortIds.add(portId)
      }
    }

    for (const regionId of solver.topology.incidentPortRegion[
      activeRouteBfs.startPortId
    ] ?? []) {
      if (candidateRegionIds.has(regionId)) {
        reachableRegionIds.add(regionId)
      }
    }

    for (const key of activeRouteBfs.seen) {
      const [portIdText, regionIdText] = key.split(":")
      const portId = Number(portIdText)
      const regionId = Number(regionIdText)
      if (Number.isFinite(portId)) reachablePortIds.add(portId)
      if (Number.isFinite(regionId)) reachableRegionIds.add(regionId)
    }

    if (activeRouteBfs.approved) {
      reachablePortIds.add(activeRouteBfs.goalPortId)
      for (const regionId of solver.topology.incidentPortRegion[
        activeRouteBfs.goalPortId
      ] ?? []) {
        if (candidateRegionIds.has(regionId)) {
          reachableRegionIds.add(regionId)
        }
      }
    }

    return {
      candidateRegionIds,
      candidatePortIds,
      reachableRegionIds,
      reachablePortIds,
      blockedPortIds,
    }
  }

  private getRouteRootConnectionName(
    routeMetadata: any,
    routeId: number,
  ): string | null {
    return (
      routeMetadata?.simpleRouteConnection?.rootConnectionName ??
      routeMetadata?.mutuallyConnectedNetworkId ??
      routeMetadata?.connectionId ??
      `route-${routeId}`
    )
  }

  private getBlockedPortIdsForRoute(
    solver: any,
    routeRootConnectionName: string | null,
  ) {
    const blockedPortIds = new Set<number>()
    const regionSegments = solver.state?.regionSegments ?? []

    for (const segments of regionSegments) {
      for (const [routeId, fromPortId, toPortId] of segments ?? []) {
        const routeMetadata = solver.problem.routeMetadata?.[routeId]
        const segmentRootName = this.getRouteRootConnectionName(
          routeMetadata,
          routeId,
        )
        if (segmentRootName && segmentRootName === routeRootConnectionName) {
          continue
        }
        blockedPortIds.add(fromPortId)
        blockedPortIds.add(toPortId)
      }
    }

    return blockedPortIds
  }

  private getPortLabel(solver: any, portId: number, reachable: boolean) {
    const incidentRegions = solver.topology.incidentPortRegion?.[portId] ?? []
    const uniqueIncidentRegions = [
      ...new Set(
        incidentRegions.map((regionId: number) => {
          const metadata = solver.topology.regionMetadata?.[regionId]
          return metadata?.capacityMeshNodeId ?? regionId
        }),
      ),
    ]

    return [
      `port ${portId}`,
      `reachable=${reachable}`,
      `regions=${
        uniqueIncidentRegions.length > 0
          ? uniqueIncidentRegions.join(",")
          : "none"
      }`,
    ].join("\n")
  }

  private createDottedLine(
    start: { x: number; y: number },
    end: { x: number; y: number },
    color: string,
  ) {
    const dx = end.x - start.x
    const dy = end.y - start.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-9) return []

    const dashLength = 0.18
    const gapLength = 0.12
    const segmentCount = Math.max(
      1,
      Math.floor(length / (dashLength + gapLength)),
    )
    const lines: NonNullable<GraphicsObject["lines"]> = []

    for (let i = 0; i < segmentCount; i++) {
      const distance0 = i * (dashLength + gapLength)
      const distance1 = Math.min(length, distance0 + dashLength)
      const t0 = distance0 / length
      const t1 = distance1 / length
      lines.push({
        points: [
          { x: start.x + dx * t0, y: start.y + dy * t0 },
          { x: start.x + dx * t1, y: start.y + dy * t1 },
        ],
        strokeColor: color,
      })
    }

    return lines
  }

  private visualizeActiveRouteBfs(): GraphicsObject {
    const activeRouteBfs = this.displayedRouteBfs
    if (!activeRouteBfs) {
      return { points: [], lines: [], rects: [], circles: [] }
    }

    const { solver } = activeRouteBfs
    const {
      candidateRegionIds,
      candidatePortIds,
      reachableRegionIds,
      reachablePortIds,
      blockedPortIds,
    } = this.getCandidateReachability(solver, activeRouteBfs)

    const rects: NonNullable<GraphicsObject["rects"]> = []
    const points: NonNullable<GraphicsObject["points"]> = []
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const solvedRouteViz = this.getSolvedRouteVisualizationFromSegments(solver)
    points.push(...solvedRouteViz.points)
    lines.push(...solvedRouteViz.lines)

    for (const regionId of candidateRegionIds) {
      const reachable = reachableRegionIds.has(regionId)
      const rect = this.getRegionRect(solver, regionId, {
        fill: reachable ? "rgba(0, 102, 255, 0.14)" : "rgba(255, 59, 48, 0.12)",
        stroke: reachable ? "#0066ff" : "#ff3b30",
        label: `${reachable ? "reachable" : "unreachable"} region ${regionId}`,
      })
      if (rect) rects.push(rect)
    }

    for (const portId of candidatePortIds) {
      const point = this.getPortPoint(solver, portId)
      if (!point) continue
      const reachable = reachablePortIds.has(portId)
      points.push({
        ...point,
        color: reachable ? "#0066ff" : "#ff3b30",
        label: this.getPortLabel(solver, portId, reachable),
      })
    }

    for (const portId of blockedPortIds) {
      const point = this.getPortPoint(solver, portId)
      if (!point) continue
      const reachable = reachablePortIds.has(portId)
      points.push({
        ...point,
        color: "#ff2d96",
        label: this.getPortLabel(solver, portId, reachable),
      })
    }

    const routeMetadata = solver.problem.routeMetadata?.[activeRouteBfs.routeId]
    const startTarget =
      routeMetadata?.simpleRouteConnection?.pointsToConnect?.[0]
    const endTarget = routeMetadata?.simpleRouteConnection?.pointsToConnect?.[1]
    if (startTarget && endTarget) {
      lines.push(
        ...this.createDottedLine(
          { x: startTarget.x, y: startTarget.y },
          { x: endTarget.x, y: endTarget.y },
          "#111111",
        ),
      )
      points.push({
        x: startTarget.x,
        y: startTarget.y,
        color: "#111111",
        label: `start target ${activeRouteBfs.routeLabel}`,
      })
      points.push({
        x: endTarget.x,
        y: endTarget.y,
        color: "#111111",
        label: `end target ${activeRouteBfs.routeLabel}`,
      })
    }

    return {
      title: `BFS ${activeRouteBfs.routeLabel}${activeRouteBfs.approved ? " solved" : " active"}`,
      rects,
      points,
      lines,
      circles: [],
    }
  }

  private getSolvedRouteVisualizationFromSegments(solver: any) {
    const points: NonNullable<GraphicsObject["points"]> = []
    const lines: NonNullable<GraphicsObject["lines"]> = []
    const seenPoints = new Set<number>()
    const regionSegments = solver.state?.regionSegments ?? []

    for (const segments of regionSegments) {
      for (const [routeId, fromPortId, toPortId] of segments ?? []) {
        const fromPoint = this.getPortPoint(solver, fromPortId)
        const toPoint = this.getPortPoint(solver, toPortId)
        if (fromPoint && toPoint) {
          lines.push({
            points: [fromPoint, toPoint],
            strokeColor: "#ff2d96",
          })
        }
        if (fromPoint && !seenPoints.has(fromPortId)) {
          seenPoints.add(fromPortId)
          points.push({
            ...fromPoint,
            color: "#ff2d96",
            label: `solved port ${fromPortId}`,
          })
        }
        if (toPoint && !seenPoints.has(toPortId)) {
          seenPoints.add(toPortId)
          points.push({
            ...toPoint,
            color: "#ff2d96",
            label: `solved port ${toPortId}`,
          })
        }
      }
    }

    return { points, lines }
  }

  getOutput(): {
    nodesWithPortPoints: NodeWithPortPoints[]
    inputNodeWithPortPoints: InputNodeWithPortPoints[]
  } {
    return this.wrappedSolver.getOutput()
  }

  computeNodePf(node: InputNodeWithPortPoints): number | null {
    const solvedNode = this.getOutput().nodesWithPortPoints.find(
      (candidate) => candidate.capacityMeshNodeId === node.capacityMeshNodeId,
    )
    const originalRegion = this.originalRegionById.get(node.capacityMeshNodeId)

    if (!solvedNode || !originalRegion) {
      return null
    }

    const crossings = getIntraNodeCrossingsUsingCircle(solvedNode)

    return calculateNodeProbabilityOfFailure(
      originalRegion.d,
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )
  }

  override getConstructorParams() {
    return [this.originalParams] as const
  }

  override tryFinalAcceptance() {}

  override preview(): GraphicsObject {
    return this.visualize()
  }

  override visualize(): GraphicsObject {
    return combineVisualizations(
      this.wrappedSolver.visualize(),
      this.visualizeActiveRouteBfs(),
    )
  }
}
