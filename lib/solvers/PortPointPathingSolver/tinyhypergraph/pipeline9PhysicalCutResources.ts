import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/index"

type Descriptor = { version: 1; problemId: number; cutId: string; capacity: number }
type Cut = { descriptor: Descriptor; ports: number[] }
export type PhysicalCutRules = { minTraceWidth: number; clearance: number }
export type PhysicalCutTracker = { id: number; stats: Record<string, number> }
const marker = Symbol.for("tscircuit.pipeline9.physical-cut-reservation.v1")
type GuardState = {
  original: TinyHyperGraphSolver["isPortReservedForDifferentNet"]
  trackers: Map<number, WeakRef<PhysicalCutTracker>>
  cutIndices: WeakMap<TinyHyperGraphTopology, Map<number, Cut>>
  nextProblemId: number
  installed: boolean
}
// A shared predicate must share its descriptor registry too, including when a
// source and bundled copy of this module are loaded in the same JS realm.
const prototypeState = TinyHyperGraphSolver.prototype as typeof TinyHyperGraphSolver.prototype & { [marker]?: GuardState }
const guardState: GuardState = prototypeState[marker] ?? {
  original: prototypeState.isPortReservedForDifferentNet,
  trackers: new Map(), cutIndices: new WeakMap(), nextProblemId: 1, installed: false,
}
if (!prototypeState[marker]) Object.defineProperty(prototypeState, marker, { value: guardState })
const trackers = guardState.trackers
const cutIndices = guardState.cutIndices
const EPS = 1e-7

export function createPhysicalCutTracker(): PhysicalCutTracker {
  const tracker: PhysicalCutTracker = { id: guardState.nextProblemId++, stats: {
    physicalCutSetupTimeMs: 0, physicalCutAnnotationPasses: 0, physicalCutExaminedGroups: 0,
    physicalCutTaggedGroups: 0, physicalCutTaggedPorts: 0, physicalCutSlotChoiceCount: 0,
    physicalCutProtectedGroups: 0, physicalCutUnsupportedGroups: 0, physicalCutOwnerChecks: 0,
    physicalCutAssignmentReads: 0, physicalCutCapacityRejections: 0, physicalCutSameNetReuse: 0,
    physicalCutTopologyIndexBuilds: 0,
  } }
  // The owning P9 phase retains this tracker strongly. Registry entries never
  // retain completed boards or their statistics; stale weak entries are swept.
  if (trackers.size > 64) for (const [id, reference] of trackers) if (!reference.deref()) trackers.delete(id)
  trackers.set(tracker.id, new WeakRef(tracker))
  installPhysicalCutReservationGuard()
  return tracker
}

/** Preserve every geometric slot; attach only a necessary shared resource bound. */
export function annotatePipeline9PhysicalCuts(graph: SerializedHyperGraph, rules: PhysicalCutRules, tracker: PhysicalCutTracker): SerializedHyperGraph {
  const started = performance.now()
  if (!Number.isFinite(rules.minTraceWidth) || rules.minTraceWidth <= 0 || !Number.isFinite(rules.clearance) || rules.clearance < 0) throw new Error("Physical cut has invalid width/clearance")
  const regions = new Map(graph.regions.map((region) => [region.regionId, region]))
  const protectedPorts = new Set(graph.regions.flatMap((region) => (region.assignments ?? []).flatMap((a) => [a.regionPort1Id, a.regionPort2Id])))
  const bounds = new Map(graph.regions.map((region) => [region.regionId, {
    minX: region.d.center.x - region.d.width / 2, maxX: region.d.center.x + region.d.width / 2,
    minY: region.d.center.y - region.d.height / 2, maxY: region.d.center.y + region.d.height / 2,
  }]))
  const outsideOwnerNodes = new Set<string>()
  for (const port of graph.ports) {
    if (![port.d.x, port.d.y, port.d.z].every(Number.isFinite)) throw new Error("Physical cut has nonfinite port geometry")
    for (const owner of [port.region1Id, port.region2Id]) {
      const box = bounds.get(owner)
      if (!box) throw new Error("Physical cut port owner is missing")
      if (port.d.x < box.minX - EPS || port.d.x > box.maxX + EPS || port.d.y < box.minY - EPS || port.d.y > box.maxY + EPS) outsideOwnerNodes.add(owner)
    }
  }
  const ports = graph.ports.map((port) => {
    const metadata = { ...port.d }
    delete metadata.__pipeline9PhysicalCut
    return { ...port, d: metadata }
  })
  const groups = new Map<string, typeof ports>()
  for (const port of ports) {
    if (port.d._tinyTerminal) continue
    const owners = [port.region1Id, port.region2Id].sort()
    const key = JSON.stringify([...owners, port.d.z])
    const group = groups.get(key) ?? []
    group.push(port); groups.set(key, group)
  }
  tracker.stats.physicalCutAnnotationPasses++
  for (const [key, group] of groups) {
    tracker.stats.physicalCutExaminedGroups++
    const first = regions.get(group[0]!.region1Id), second = regions.get(group[0]!.region2Id)
    if (!first || !second) throw new Error("Physical cut references a missing region")
    if ([first, second].some((region) => region.d._containsTarget || region.d._containsObstacle || region.d._offBoardConnectionId) || group.some((port) => protectedPorts.has(port.portId) || port.d._preloadedFixedNetIds?.length || port.d._preloadedTracePortAssignments?.length)) {
      tracker.stats.physicalCutProtectedGroups++
      continue
    }
    const a = bounds.get(first.regionId)!, b = bounds.get(second.regionId)!
    if (outsideOwnerNodes.has(first.regionId) || outsideOwnerNodes.has(second.regionId)) { tracker.stats.physicalCutUnsupportedGroups++; continue }
    let length = 0, line = 0, lower = 0, upper = 0, vertical = false
    if (Math.abs(a.maxX - b.minX) < EPS || Math.abs(b.maxX - a.minX) < EPS) {
      vertical = true; line = Math.abs(a.maxX - b.minX) < EPS ? a.maxX : b.maxX
      lower = Math.max(a.minY, b.minY); upper = Math.min(a.maxY, b.maxY); length = upper - lower
    } else if (Math.abs(a.maxY - b.minY) < EPS || Math.abs(b.maxY - a.minY) < EPS) {
      line = Math.abs(a.maxY - b.minY) < EPS ? a.maxY : b.maxY
      lower = Math.max(a.minX, b.minX); upper = Math.min(a.maxX, b.maxX); length = upper - lower
    }
    if (!(length > EPS) || group.some((port) => Math.abs((vertical ? port.d.x : port.d.y) - line) > EPS || (vertical ? port.d.y : port.d.x) < lower - EPS || (vertical ? port.d.y : port.d.x) > upper + EPS || !Number.isInteger(port.d.z))) {
      tracker.stats.physicalCutUnsupportedGroups++
      continue
    }
    // Centers may use both ends. This optimistic bound assumes no corner
    // inset, obstacles, via occupation, or wider nominal copper than minWidth.
    const capacity = 1 + Math.floor((length + EPS) / (rules.minTraceWidth + rules.clearance))
    const descriptor: Descriptor = { version: 1, problemId: tracker.id, cutId: key, capacity }
    for (const port of group) port.d.__pipeline9PhysicalCut = descriptor
    tracker.stats.physicalCutTaggedGroups++
    tracker.stats.physicalCutTaggedPorts += group.length
    tracker.stats.physicalCutSlotChoiceCount += group.length
  }
  tracker.stats.physicalCutSetupTimeMs += performance.now() - started
  return { ...graph, ports }
}

/** The topology index is immutable; occupancy is deliberately read LIVE. */
function getPhysicalCuts(topology: TinyHyperGraphTopology): Map<number, Cut> {
  const existing = cutIndices.get(topology)
  if (existing) return existing
  const byId = new Map<string, Cut>(), byPort = new Map<number, Cut>()
  const indexedTrackers = new Set<number>()
  for (let port = 0; port < topology.portCount; port++) {
    const descriptor = topology.portMetadata?.[port]?.__pipeline9PhysicalCut as Descriptor | undefined
    if (!descriptor) continue
    if (descriptor.version !== 1 || !Number.isInteger(descriptor.capacity) || descriptor.capacity < 1 || !trackers.get(descriptor.problemId)?.deref()) throw new Error("Physical cut descriptor is invalid or unregistered")
    const key = JSON.stringify([descriptor.problemId, descriptor.cutId])
    let cut = byId.get(key)
    if (!cut) { cut = { descriptor, ports: [] }; byId.set(key, cut) }
    if (cut.descriptor.capacity !== descriptor.capacity) throw new Error("Physical cut capacities disagree")
    cut.ports.push(port); byPort.set(port, cut); indexedTrackers.add(descriptor.problemId)
  }
  for (const id of indexedTrackers) trackers.get(id)!.deref()!.stats.physicalCutTopologyIndexBuilds++
  cutIndices.set(topology, byPort)
  return byPort
}

/**
 * Native core, full/partial rerip, and internal section evaluators inherit this
 * predicate. Metadata-free inputs invoke the original predicate exactly once.
 * No slot is removed and no original search/repair budget is changed.
 */
export function installPhysicalCutReservationGuard(): void {
  const prototype = TinyHyperGraphSolver.prototype
  if (guardState.installed) return
  const original = guardState.original
  prototype.isPortReservedForDifferentNet = function(this: TinyHyperGraphSolver, portId: number): boolean {
    if (!this.topology.portMetadata?.[portId]?.__pipeline9PhysicalCut) return original.call(this, portId)
    if (original.call(this, portId)) return true
    const cut = getPhysicalCuts(this.topology).get(portId)
    if (!cut) throw new Error("Physical cut port has no indexed resource")
    const tracker = trackers.get(cut.descriptor.problemId)?.deref()
    if (!tracker) throw new Error("Physical cut tracker has detached from its owning phase")
    const stats = tracker.stats
    stats.physicalCutOwnerChecks++
    const owners = new Set<number>()
    for (const other of cut.ports) {
      stats.physicalCutAssignmentReads++
      const owner = this.state.portAssignment[other]!
      if (owner < 0) continue
      if (owner === this.state.currentRouteNetId) { stats.physicalCutSameNetReuse++; return false }
      owners.add(owner)
    }
    if (owners.size >= cut.descriptor.capacity) { stats.physicalCutCapacityRejections++; return true }
    return false
  }
  guardState.installed = true
}
