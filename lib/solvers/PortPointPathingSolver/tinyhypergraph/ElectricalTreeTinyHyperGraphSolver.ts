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
}

type TreeTarget = {
  routeId: number
  startPortId: number
  targetPortId: number
  suffix: TreeSegment[]
  materializedSuffixSegmentCount?: number
  removedRetracedSegmentCount?: number
}

/**
 * Searches toward a committed electrical tree, rather than repeatedly toward
 * the same remote terminal. The destination's connected component is rebuilt
 * from live route ownership at a route boundary, so selective/global rips can
 * never leave a stale tree target. The reused suffix is also committed under
 * the new route owner: ripping its former owner cannot disconnect this pair.
 */
export class ElectricalTreeTinyHyperGraphSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  private treeTarget?: TreeTarget
  private readonly routeCountByNet = new Map<number, number>()
  private readonly initiallyAssignedRouteIds: Set<number>

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
    this.stats.electricalTreeTargetCount = 0
    this.stats.electricalTreeSuffixSegmentCount = 0
    this.stats.electricalTreeIndexSegmentReads = 0
    this.stats.electricalTreeSearchStepCount = 0
    this.stats.electricalTreeRemovedRetracedSegmentCount = 0
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

  private buildTreeTarget(routeId: number, startPortId: number, endPortId: number): TreeTarget {
    const target: TreeTarget = { routeId, startPortId, targetPortId: endPortId, suffix: [] }
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
        const forward = adjacency.get(fromPortId) ?? []
        forward.push({ regionId, fromPortId, toPortId })
        adjacency.set(fromPortId, forward)
        const reverse = adjacency.get(toPortId) ?? []
        reverse.push({ regionId, fromPortId: toPortId, toPortId: fromPortId })
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
      if (!adjacency.has(rootPortId)) continue
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
        for (const segment of adjacency.get(portId) ?? []) {
          if (visited.has(segment.toPortId)) continue
          visited.add(segment.toPortId)
          towardEnd.set(segment.toPortId, {
            regionId: segment.regionId,
            fromPortId: segment.toPortId,
            toPortId: portId,
          })
          queue.push(segment.toPortId)
        }
      }
      if (!selected) continue
      target.startPortId = sourcePortId
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
    target.materializedSuffixSegmentCount = target.suffix.length - suffixStart
    target.removedRetracedSegmentCount = segments.length - prefixLength + suffixStart
    return [...segments.slice(0, prefixLength), ...target.suffix.slice(suffixStart)]
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
          target.removedRetracedSegmentCount === undefined
        ) {
          throw new Error("Electrical tree committed without materializing its suffix")
        }
        this.stats.electricalTreeTargetCount += 1
        this.stats.electricalTreeSuffixSegmentCount +=
          target.materializedSuffixSegmentCount
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
