import type {
  Candidate,
  TinyHyperGraphProblem,
  TinyHyperGraphSolverOptions,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "./SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { hasPreloadedTraceSectionMetadata } from "./serializePreloadedTraceAssignments"

type TreeSegment = {
  regionId: number
  fromPortId: number
  toPortId: number
  physicalTerminalConnector?: true
}

type TreeTarget = {
  routeId: number
  startPortId: number
  endPortId: number
  targetPortId: number
  suffix: TreeSegment[]
  materializedSuffixSegmentCount?: number
  materializedAliasConnectorCount?: number
  removedRetracedSegmentCount?: number
}

/**
 * Searches toward a committed electrical tree, rather than repeatedly toward
 * the same remote terminal. The destination's connected component is rebuilt
 * from live route ownership at a route boundary, so selective/global rips can
 * never leave a stale tree target. The reused suffix is also committed under
 * the new route's logical ownership view. Physical edge geometry is counted
 * once by the regional cache and compiled once for detailed routing; removing
 * one owner retains copper referenced by another live demand.
 */
export class ElectricalTreeTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  private treeTarget?: TreeTarget
  private readonly routeCountByNet = new Map<number, number>()
  private readonly initiallyAssignedRouteIds: Set<number>
  private readonly physicalTerminalKeyByPort = new Map<number, string>()
  private readonly terminalPortsByPhysicalKey = new Map<string, number[]>()
  declare private physicalCacheKeys?: WeakMap<object, Set<string>>

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    this.initiallyAssignedRouteIds = new Set(
      (problem.initialAssignments ?? []).map((assignment) => assignment.routeId),
    )
    for (const netId of problem.routeNet) {
      this.routeCountByNet.set(netId, (this.routeCountByNet.get(netId) ?? 0) + 1)
    }
    const excludedPorts = new Set<number>()
    for (const assignment of problem.initialAssignments ?? []) {
      excludedPorts.add(assignment.fromPortId)
      excludedPorts.add(assignment.toPortId)
    }
    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      if (!hasPreloadedTraceSectionMetadata(problem.routeMetadata?.[routeId])) {
        continue
      }
      excludedPorts.add(problem.routeStartPort[routeId]!)
      excludedPorts.add(problem.routeEndPort[routeId]!)
    }
    for (let portId = 0; portId < topology.portCount; portId++) {
      const metadata = topology.portMetadata?.[portId]
      const pcbPortId = metadata?.pcb_port_id
      const x = topology.portX[portId]!
      const y = topology.portY[portId]!
      const z = topology.portZ[portId]!
      if (
        excludedPorts.has(portId) ||
        metadata?._tinyTerminal !== true ||
        typeof pcbPortId !== "string" ||
        pcbPortId.length === 0 ||
        ![x, y, z].every(Number.isFinite) ||
        (Array.isArray(metadata._preloadedFixedNetIds) &&
          metadata._preloadedFixedNetIds.length > 0) ||
        (Array.isArray(metadata._preloadedTracePortAssignments) &&
          metadata._preloadedTracePortAssignments.length > 0)
      ) {
        continue
      }
      const key = JSON.stringify([pcbPortId, x, y, z])
      this.physicalTerminalKeyByPort.set(portId, key)
      const ports = this.terminalPortsByPhysicalKey.get(key) ?? []
      ports.push(portId)
      this.terminalPortsByPhysicalKey.set(key, ports)
    }
    this.stats.electricalTreeTargetCount = 0
    this.stats.electricalTreeSuffixSegmentCount = 0
    this.stats.electricalTreeAliasConnectorCount = 0
    this.stats.electricalTreeIndexSegmentReads = 0
    this.stats.electricalTreeSearchStepCount = 0
    this.stats.electricalTreeRemovedRetracedSegmentCount = 0
    this.stats.electricalTreeSharedCacheReferenceCount = 0
    this.stats.electricalTreePhysicalCacheEdgeCount = 0
  }

  override appendSegmentToRegionCache(regionId: number, fromPortId: number, toPortId: number): void {
    const cache = this.state.regionIntersectionCaches[regionId]!
    const indices = this.physicalCacheKeys ??= new WeakMap<object, Set<string>>()
    let keys = indices.get(cache)
    if (!keys) {
      if (cache.existingSegmentCount !== 0) {
        throw new Error(`Electrical tree lost physical cache ownership in region ${regionId}`)
      }
      keys = new Set<string>()
      indices.set(cache, keys)
    }
    const from = [this.topology.portX[fromPortId], this.topology.portY[fromPortId], this.topology.portZ[fromPortId]]
    const to = [this.topology.portX[toPortId], this.topology.portY[toPortId], this.topology.portZ[toPortId]]
    const netId = this.state.currentRouteNetId
    const knownNet = typeof netId === "number" && netId >= 0
    if (knownNet && from.every((coordinate, index) => coordinate === to[index])) return
    const key = JSON.stringify([netId, ...[JSON.stringify(from), JSON.stringify(to)].sort()])
    if (knownNet && keys.has(key)) {
      this.stats.electricalTreeSharedCacheReferenceCount = (this.stats.electricalTreeSharedCacheReferenceCount ?? 0) + 1
      return
    }
    super.appendSegmentToRegionCache(regionId, fromPortId, toPortId)
    keys.add(key)
    indices.set(this.state.regionIntersectionCaches[regionId]!, keys)
    this.stats.electricalTreePhysicalCacheEdgeCount = (this.stats.electricalTreePhysicalCacheEdgeCount ?? 0) + 1
  }

  protected override getRouteStartPortId(routeId: number): number {
    const target = this.getTreeTarget(routeId)
    return target ? target.startPortId : super.getRouteStartPortId(routeId)
  }

  protected override getRouteEndPortId(routeId: number): number {
    const target = this.getTreeTarget(routeId)
    return target ? target.targetPortId : super.getRouteEndPortId(routeId)
  }

  private getTreeTarget(routeId: number): TreeTarget | undefined {
    const netId = this.problem.routeNet[routeId]
    if (
      netId === undefined ||
      netId < 0 ||
      this.state.currentRouteId !== routeId ||
      this.partialRipRoutePlans.has(routeId) ||
      this.initiallyAssignedRouteIds.has(routeId) ||
      hasPreloadedTraceSectionMetadata(this.problem.routeMetadata?.[routeId]) ||
      (this.routeCountByNet.get(netId) ?? 0) < 2
    ) {
      return undefined
    }
    if (this.treeTarget?.routeId === routeId) return this.treeTarget
    this.treeTarget = this.buildTreeTarget(
      routeId,
      super.getRouteStartPortId(routeId),
      super.getRouteEndPortId(routeId),
    )
    return this.treeTarget
  }

  private getPhysicalAliasSegments(
    portId: number,
    rootPortId: number,
    adjacency: Map<number, TreeSegment[]>,
  ): TreeSegment[] {
    const key = this.physicalTerminalKeyByPort.get(portId)
    if (key === undefined) return []
    const segments: TreeSegment[] = []
    const x = this.topology.portX[portId]!
    const y = this.topology.portY[portId]!
    const z = this.topology.portZ[portId]!
    for (const aliasPortId of this.terminalPortsByPhysicalKey.get(key)!) {
      if (
        aliasPortId === portId ||
        (!adjacency.has(aliasPortId) && aliasPortId !== rootPortId)
      ) {
        continue
      }
      for (const regionId of this.topology.incidentPortRegion[portId]!) {
        const availableZMask = this.topology.regionAvailableZMask?.[regionId]
        if (
          !this.topology.incidentPortRegion[aliasPortId]!.includes(regionId) ||
          this.topology.regionMetadata?.[regionId]?._tinyTerminal === true ||
          availableZMask === undefined || (availableZMask & (1 << z)) === 0
        ) {
          continue
        }
        const width = this.topology.regionWidth[regionId]!
        const height = this.topology.regionHeight[regionId]!
        const centerX = this.topology.regionCenterX[regionId]!
        const centerY = this.topology.regionCenterY[regionId]!
        if (
          ![width, height, centerX, centerY].every(Number.isFinite) ||
          width <= 0 ||
          height <= 0 ||
          x < centerX - width / 2 - 1e-9 ||
          x > centerX + width / 2 + 1e-9 ||
          y < centerY - height / 2 - 1e-9 ||
          y > centerY + height / 2 + 1e-9 ||
          (adjacency.has(portId) && !adjacency.get(portId)!.some(
            (segment) => segment.regionId === regionId,
          )) ||
          (adjacency.has(aliasPortId) && !adjacency.get(aliasPortId)!.some(
            (segment) => segment.regionId === regionId,
          ))
        ) {
          continue
        }
        // Both committed sides belong to this route's verified same-net copper
        // index. The current root may be new, but must be the same physical pad.
        segments.push({
          regionId,
          fromPortId: portId,
          toPortId: aliasPortId,
          physicalTerminalConnector: true,
        })
        break
      }
    }
    return segments
  }

  private isPhysicalTerminalConnector(segment: TreeSegment): boolean {
    const fromKey = this.physicalTerminalKeyByPort.get(segment.fromPortId)
    const toKey = this.physicalTerminalKeyByPort.get(segment.toPortId)
    return segment.fromPortId !== segment.toPortId &&
      fromKey !== undefined && fromKey === toKey
  }

  private buildTreeTarget(routeId: number, startPortId: number, endPortId: number): TreeTarget {
    const target: TreeTarget = { routeId, startPortId, endPortId, targetPortId: endPortId, suffix: [] }
    const netId = this.problem.routeNet[routeId]!
    const z = this.topology.portZ[endPortId]!
    if (this.topology.portZ[startPortId] !== z) return target
    // A direct region hop is already available to the original search. A
    // geometric tree target can otherwise send this route out and back again.
    if (this.topology.incidentPortRegion[startPortId]!.some((regionId) =>
      this.topology.incidentPortRegion[endPortId]!.includes(regionId),
    )) return target

    const adjacency = new Map<number, TreeSegment[]>()
    for (let regionId = 0; regionId < this.state.regionSegments.length; regionId++) {
      for (const [ownerRouteId, fromPortId, toPortId] of this.state.regionSegments[regionId]!) {
        this.stats.electricalTreeIndexSegmentReads += 1
        if (
          ownerRouteId === routeId ||
          this.problem.routeNet[ownerRouteId] !== netId ||
          this.initiallyAssignedRouteIds.has(ownerRouteId) ||
          hasPreloadedTraceSectionMetadata(this.problem.routeMetadata?.[ownerRouteId]) ||
          this.topology.portZ[fromPortId] !== z ||
          this.topology.portZ[toPortId] !== z
        ) {
          continue
        }
        const segment: TreeSegment = { regionId, fromPortId, toPortId }
        if (this.isPhysicalTerminalConnector(segment)) {
          segment.physicalTerminalConnector = true
        }
        const forward = adjacency.get(fromPortId) ?? []
        forward.push(segment)
        adjacency.set(fromPortId, forward)
        const reverse = adjacency.get(toPortId) ?? []
        reverse.push({ ...segment, fromPortId: toPortId, toPortId: fromPortId })
        adjacency.set(toPortId, reverse)
      }
    }
    let bestDistance = Math.hypot(
      this.topology.portX[startPortId]! - this.topology.portX[endPortId]!,
      this.topology.portY[startPortId]! - this.topology.portY[endPortId]!,
    )
    // Either terminal may already belong to the routed tree. Search from the
    // new terminal toward that component, independent of input pair direction.
    for (const [sourcePortId, rootPortId] of [[startPortId, endPortId], [endPortId, startPortId]]) {
      const rootAliases = this.getPhysicalAliasSegments(rootPortId, rootPortId, adjacency)
      if (!adjacency.has(rootPortId) && rootAliases.length === 0) continue
      const towardEnd = new Map<number, TreeSegment>()
      const visited = new Set<number>([rootPortId])
      const queue = [rootPortId]
      let selectedPortId = rootPortId
      let selected = false
      for (let head = 0; head < queue.length; head++) {
        const portId = queue[head]!
        const distance = Math.hypot(
          this.topology.portX[sourcePortId]! - this.topology.portX[portId]!,
          this.topology.portY[sourcePortId]! - this.topology.portY[portId]!,
        )
        if (distance < bestDistance) {
          bestDistance = distance
          selectedPortId = portId
          selected = true
        }
        for (const segment of [
          ...(adjacency.get(portId) ?? []),
          ...this.getPhysicalAliasSegments(portId, rootPortId, adjacency),
        ]) {
          if (visited.has(segment.toPortId)) continue
          visited.add(segment.toPortId)
          towardEnd.set(segment.toPortId, {
            ...segment,
            regionId: segment.regionId,
            fromPortId: segment.toPortId,
            toPortId: portId,
          })
          queue.push(segment.toPortId)
        }
      }
      if (!selected) continue
      target.startPortId = sourcePortId
      target.endPortId = rootPortId
      target.targetPortId = selectedPortId
      target.suffix = []
      let cursor = selectedPortId
      while (cursor !== rootPortId) {
        const segment = towardEnd.get(cursor)
        if (!segment) throw new Error(`Electrical tree lost route ${routeId}'s destination component`)
        target.suffix.push(segment)
        cursor = segment.toPortId
      }
    }
    return target
  }

  protected override getRouteHeuristic(routeId: number, portId: number): number {
    if (this.treeTarget?.routeId !== routeId || this.treeTarget.suffix.length === 0) {
      return super.getRouteHeuristic(routeId, portId)
    }
    const targetPortId = this.treeTarget.targetPortId
    return Math.hypot(
      this.topology.portX[portId]! - this.topology.portX[targetPortId]!,
      this.topology.portY[portId]! - this.topology.portY[targetPortId]!,
    ) * this.DISTANCE_TO_COST
  }

  override getSolvedPathSegments(finalCandidate: Candidate): TreeSegment[] {
    const segments = super.getSolvedPathSegments(finalCandidate)
    const target = this.treeTarget
    if (!target || target.routeId !== this.state.currentRouteId) return segments
    const suffixIndexByPort = new Map<number, number>()
    for (let index = 0; index < target.suffix.length; index++) {
      suffixIndexByPort.set(target.suffix[index]!.fromPortId, index)
    }
    if (target.suffix.length > 0) {
      suffixIndexByPort.set(target.suffix.at(-1)!.toPortId, target.suffix.length)
    }
    let prefixLength = segments.length
    let suffixStart = 0
    const sourceSuffixIndex = suffixIndexByPort.get(target.startPortId)
    if (sourceSuffixIndex !== undefined) {
      prefixLength = 0
      suffixStart = sourceSuffixIndex
    } else {
      // Reaching any earlier port of the retained suffix closes the same
      // electrical contract. Stop there before a later target adds a cycle.
      for (let index = 0; index < segments.length; index++) {
        const suffixIndex = suffixIndexByPort.get(segments[index]!.toPortId)
        if (suffixIndex === undefined) continue
        prefixLength = index + 1
        suffixStart = suffixIndex
        break
      }
    }
    const ownedSegments = [...segments.slice(0, prefixLength), ...target.suffix.slice(suffixStart)]
    if (
      target.suffix.length > 0 && (
        ownedSegments[0]?.fromPortId !== target.startPortId ||
        ownedSegments.at(-1)?.toPortId !== target.endPortId ||
        ownedSegments.some((segment, index) =>
          index > 0 && ownedSegments[index - 1]!.toPortId !== segment.fromPortId,
        )
      )
    ) {
      throw new Error(`Electrical tree lost route ${target.routeId}'s original terminal path`)
    }
    target.materializedSuffixSegmentCount = target.suffix.slice(suffixStart)
      .filter((segment) => !segment.physicalTerminalConnector).length
    target.materializedAliasConnectorCount = ownedSegments
      .filter((segment) => this.isPhysicalTerminalConnector(segment)).length
    target.removedRetracedSegmentCount = segments.length - prefixLength + suffixStart
    return ownedSegments
  }

  override onPathFound(finalCandidate: Candidate): void {
    const target = this.treeTarget
    super.onPathFound(finalCandidate)
    // Distance-aware acceptance may enqueue the final segment first. Count
    // reuse only after the full endpoint path was actually committed.
    if (this.state.currentRouteId === undefined && target) {
      if (target.suffix.length > 0) {
        if (
          target.materializedSuffixSegmentCount === undefined ||
          target.materializedAliasConnectorCount === undefined ||
          target.removedRetracedSegmentCount === undefined
        ) {
          throw new Error("Electrical tree committed without materializing its suffix")
        }
        this.stats.electricalTreeTargetCount += 1
        this.stats.electricalTreeSuffixSegmentCount +=
          target.materializedSuffixSegmentCount
        this.stats.electricalTreeAliasConnectorCount +=
          target.materializedAliasConnectorCount
        this.stats.electricalTreeRemovedRetracedSegmentCount +=
          target.removedRetracedSegmentCount
      }
      this.treeTarget = undefined
    }
  }

  override _step(): void {
    const activeTarget = this.treeTarget
    super._step()
    if ((activeTarget ?? this.treeTarget)?.suffix.length) {
      this.stats.electricalTreeSearchStepCount += 1
    }
  }

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    this.treeTarget = undefined
  }

  override resetRoutingStateForRerip(): void {
    this.treeTarget = undefined
    super.resetRoutingStateForRerip()
  }
}
