import { MinHeap } from "tiny-hypergraph/lib/MinHeap"
import { computeRegionCost, TRACE_VIA_MARGIN } from "tiny-hypergraph/lib/computeRegionCost"
import type { TinyHyperGraphSolver, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import type { ParallelStageWorkerPool, ParallelStageWorkerResult } from "./parallelStageWorkerTypes"

export type TinyLandmarkGraph = {
  portOffsets: Int32Array
  targets: Int32Array
  costs: Float64Array
}

export type TinyLandmarkDistances = {
  distances: Float64Array
  expandedPortCount: number
  relaxationCount: number
}

function allocateBuffer(byteLength: number): ArrayBufferLike {
  // The coordinator and all existing workers read this immutable graph. Shared
  // storage avoids copying large CSR tables once per landmark.
  return typeof SharedArrayBuffer === "undefined"
    ? new ArrayBuffer(byteLength)
    : new SharedArrayBuffer(byteLength)
}

/** Dijkstra on an immutable, nonnegative relaxed graph; used in existing workers. */
export function computeTinyLandmarkDistances(
  graph: TinyLandmarkGraph,
  landmarkPortId: number,
): TinyLandmarkDistances {
  const portCount = graph.portOffsets.length - 1
  if (graph.targets.length !== graph.costs.length || graph.portOffsets[0] !== 0 ||
      graph.portOffsets[portCount] !== graph.targets.length) throw new Error("Landmark CSR graph is inconsistent")
  if (!Number.isInteger(landmarkPortId) || landmarkPortId < 0 || landmarkPortId >= portCount) {
    throw new Error("Landmark port is outside the graph")
  }
  const distances = new Float64Array(portCount).fill(Number.POSITIVE_INFINITY)
  distances[landmarkPortId] = 0
  const queue = new MinHeap<{ portId: number; cost: number }>([], (left, right) => left.cost - right.cost)
  queue.queue({ portId: landmarkPortId, cost: 0 })
  let expandedPortCount = 0
  let relaxationCount = 0
  while (queue.length > 0) {
    const candidate = queue.dequeue()!
    if (candidate.cost !== distances[candidate.portId]) continue
    expandedPortCount++
    for (let edge = graph.portOffsets[candidate.portId]!; edge < graph.portOffsets[candidate.portId + 1]!; edge++) {
      relaxationCount++
      const target = graph.targets[edge]!
      const edgeCost = graph.costs[edge]!
      if (target < 0 || target >= portCount || !Number.isFinite(edgeCost) || edgeCost < 0) {
        throw new Error("Landmark graph has an invalid target or edge cost")
      }
      const cost = candidate.cost + edgeCost
      if (cost >= distances[target]!) continue
      distances[target] = cost
      queue.queue({ portId: target, cost })
    }
  }
  return { distances, expandedPortCount, relaxationCount }
}

/**
 * Four static landmark bounds retain obstacles, port penalties and unavoidable
 * layer-change costs while relaxing occupancy, net reservations and directed
 * region transitions. Every source segment is an edge of this relaxed graph.
 *
 * A directed edge pays its destination penalty. Moving half that penalty to
 * each endpoint creates a symmetric metric; the endpoint potential restores
 * the directed bound. Region cost is monotone for the validated nonnegative
 * options. Its layer-change increment is at least the empty-region increment.
 */
export class TinyLandmarkHeuristic {
  readonly graph: TinyLandmarkGraph
  readonly landmarkPortIds: number[] = []
  readonly halfPenalties: Float64Array
  private readonly distanceToCost: number
  private readonly minViaPadDiameter: number
  private readonly topology: TinyHyperGraphTopology
  private readonly portPenalty: Float64Array | undefined
  private readonly distances: Float64Array[] = []
  private preparation?: Promise<void>
  ready = false
  readonly stats = {
    landmarkCount: 0,
    landmarkGraphEdgeCount: 0,
    landmarkExpandedPortCount: 0,
    landmarkRelaxationCount: 0,
  }

  constructor(solver: TinyHyperGraphSolver) {
    this.topology = solver.topology
    this.portPenalty = solver.problem.portPenalty
    this.distanceToCost = solver.DISTANCE_TO_COST
    this.minViaPadDiameter = solver.minViaPadDiameter
    this.validateSolver(solver)
    const { topology, problem } = solver
    const portCount = topology.portCount
    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const seenPorts = new Set<number>()
      for (const portId of topology.regionIncidentPorts[regionId] ?? []) {
        if (!Number.isInteger(portId) || portId < 0 || portId >= portCount ||
            seenPorts.has(portId) || !topology.incidentPortRegion[portId]?.includes(regionId)) {
          throw new Error("Landmark topology requires unique symmetric region-port incidence")
        }
        seenPorts.add(portId)
      }
    }
    const portOffsets = new Int32Array(allocateBuffer((portCount + 1) * Int32Array.BYTES_PER_ELEMENT))
    this.halfPenalties = Float64Array.from({ length: portCount }, (_, portId) => (problem.portPenalty?.[portId] ?? 0) / 2)
    for (let portId = 0; portId < portCount; portId++) {
      let count = 0
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        const regionPorts = topology.regionIncidentPorts[regionId]
        if (!regionPorts) throw new Error("Landmark topology has an invalid incident region")
        count += Math.max(0, regionPorts.length - 1)
      }
      const nextOffset = portOffsets[portId]! + count
      if (!Number.isSafeInteger(nextOffset) || nextOffset > 0x7fffffff) {
        throw new Error("Landmark graph exceeds CSR index capacity")
      }
      portOffsets[portId + 1] = nextOffset
    }
    const edgeCount = portOffsets[portCount]!
    const targets = new Int32Array(allocateBuffer(edgeCount * Int32Array.BYTES_PER_ELEMENT))
    const costs = new Float64Array(allocateBuffer(edgeCount * Float64Array.BYTES_PER_ELEMENT))
    for (let portId = 0; portId < portCount; portId++) {
      let offset = portOffsets[portId]!
      for (const regionId of topology.incidentPortRegion[portId] ?? []) {
        const viaCost = 1.2 * (this.minViaPadDiameter + TRACE_VIA_MARGIN) ** 2 /
          (topology.regionWidth[regionId]! * topology.regionHeight[regionId]!)
        for (const target of topology.regionIncidentPorts[regionId]!) {
          if (portId === target) continue
          if (!Number.isInteger(target) || target < 0 || target >= portCount) {
            throw new Error("Landmark topology has an invalid region port")
          }
          const dx = topology.portX[portId]! - topology.portX[target]!
          const dy = topology.portY[portId]! - topology.portY[target]!
          const cost = Math.sqrt(dx * dx + dy * dy) * this.distanceToCost +
            this.halfPenalties[portId]! + this.halfPenalties[target]! +
            (topology.portZ[portId] !== topology.portZ[target] ? viaCost : 0)
          if (!Number.isFinite(cost) || cost < 0) throw new Error("Landmark edge cost is not finite and nonnegative")
          targets[offset] = target
          costs[offset++] = cost
        }
      }
      if (offset !== portOffsets[portId + 1]) throw new Error("Landmark region incidence is inconsistent")
    }
    this.graph = { portOffsets, targets, costs }
    this.stats.landmarkGraphEdgeCount = edgeCount
    for (const [signX, signY] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
      let corner = -1
      let projection = Number.POSITIVE_INFINITY
      for (let portId = 0; portId < portCount; portId++) {
        if (portOffsets[portId + 1] === portOffsets[portId]) continue
        const value = signX! * topology.portX[portId]! + signY! * topology.portY[portId]!
        if (value < projection) { corner = portId; projection = value }
      }
      if (corner >= 0 && !this.landmarkPortIds.includes(corner)) this.landmarkPortIds.push(corner)
    }
    this.stats.landmarkCount = this.landmarkPortIds.length
  }

  validateSolver(solver: TinyHyperGraphSolver): void {
    if (solver.topology !== this.topology || solver.problem.portPenalty !== this.portPenalty ||
        !Object.is(solver.DISTANCE_TO_COST, this.distanceToCost) ||
        !Object.is(solver.minViaPadDiameter, this.minViaPadDiameter)) {
      throw new Error("Landmark heuristic is incompatible with this route search")
    }
    for (const value of [solver.DISTANCE_TO_COST, solver.minViaPadDiameter,
      solver.TRACE_DENSITY_COST_FACTOR, solver.RIP_CONGESTION_REGION_COST_FACTOR]) {
      if (!Number.isFinite(value) || value < 0) throw new Error("Landmark routing requires finite nonnegative cost options")
    }
    const { topology, problem, state } = solver
    for (let portId = 0; portId < topology.portCount; portId++) {
      const penalty = problem.portPenalty?.[portId] ?? 0
      if (!Number.isFinite(penalty) || penalty < 0) throw new Error("Landmark routing requires finite nonnegative port penalties")
      if (!Number.isFinite(topology.portX[portId]) || !Number.isFinite(topology.portY[portId])) {
        throw new Error("Landmark routing requires finite port coordinates")
      }
    }
    for (let regionId = 0; regionId < topology.regionCount; regionId++) {
      const width = topology.regionWidth[regionId]!
      const height = topology.regionHeight[regionId]!
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error("Landmark routing requires positive finite region dimensions")
      }
      const cache = state.regionIntersectionCaches[regionId]!
      for (const count of [cache.existingSameLayerIntersections, cache.existingCrossingLayerIntersections,
        cache.existingEntryExitLayerChanges, cache.existingSegmentCount]) {
        if (!Number.isInteger(count) || count < 0) throw new Error("Landmark routing requires nonnegative region counters")
      }
      const expectedCost = computeRegionCost(width, height, cache.existingSameLayerIntersections,
        cache.existingCrossingLayerIntersections, cache.existingEntryExitLayerChanges,
        cache.existingSegmentCount, topology.regionAvailableZMask?.[regionId] ?? 0,
        solver.minViaPadDiameter, solver.TRACE_DENSITY_COST_FACTOR)
      if (!Number.isFinite(expectedCost) || !Object.is(cache.existingRegionCost, expectedCost) ||
          !Number.isFinite(state.regionCongestionCost[regionId]) || state.regionCongestionCost[regionId]! < 0) {
        throw new Error("Landmark routing requires consistent nonnegative region costs")
      }
    }
  }

  prepareSync(): void {
    if (this.ready) return
    if (this.preparation) throw new Error("Landmark worker preparation is already pending")
    this.commit(this.landmarkPortIds.map((portId) => computeTinyLandmarkDistances(this.graph, portId)))
  }

  prepare(workerPool: ParallelStageWorkerPool): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (!this.preparation) {
      this.preparation = Promise.all(this.landmarkPortIds.map((landmarkPortId) =>
        workerPool.run<ParallelStageWorkerResult>({ kind: "pathingLandmark", graph: this.graph, landmarkPortId })
          .then((result): TinyLandmarkDistances => {
            if (result.kind !== "pathingLandmark") throw new Error("Invalid landmark worker result")
            return result
          }),
      )).then((results): void => this.commit(results))
    }
    return this.preparation
  }

  private commit(results: TinyLandmarkDistances[]): void {
    for (const result of results) {
      if (result.distances.length !== this.topology.portCount) throw new Error("Landmark distances have an invalid size")
      this.distances.push(result.distances)
      this.stats.landmarkExpandedPortCount += result.expandedPortCount
      this.stats.landmarkRelaxationCount += result.relaxationCount
    }
    this.ready = true
  }

  lowerBound(portId: number, targetId: number): number {
    if (!this.ready) throw new Error("Landmark heuristic was used before preparation completed")
    let bound = 0
    for (const distances of this.distances) {
      const target = distances[targetId]!
      const source = distances[portId]!
      if (!Number.isFinite(target) || !Number.isFinite(source)) continue
      bound = Math.max(bound, Math.abs(target - source))
    }
    return Math.max(0, bound + this.halfPenalties[targetId]! - this.halfPenalties[portId]!)
  }
}
