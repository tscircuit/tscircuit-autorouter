import type { TinyHyperGraphProblem, TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { TinyLandmarkHeuristic } from "./TinyLandmarkHeuristic"
import { executeParallelGoalBallJob } from "./parallelGoalBallWorkerJobs"
import type { ParallelStageWorkerPool } from "./parallelStageWorkerTypes"
import type { ParallelGoalBallWorkerPool, ParallelGoalBallWorkerResult,
  TinyGoalBallBounds, TinyGoalBallGraph, TinyGoalBallGroup } from "./parallelGoalBallWorkerTypes"

export type TinyGoalBallCostSolver = TinyHyperGraphSolver & { readonly goalBallScoresGeometricSegments: boolean }

function sharedBuffer(byteLength: number): ArrayBufferLike {
  // All four existing workers read the same immutable static arrays.
  return typeof SharedArrayBuffer === "undefined" ? new ArrayBuffer(byteLength) : new SharedArrayBuffer(byteLength)
}

/** Capped net-aware goal searches combined with four global landmark bounds. */
export class TinyGoalBallHeuristic {
  readonly graph: TinyGoalBallGraph
  readonly maximumSettledPorts: number
  readonly stats = {
    goalBallGroupCount: 0,
    goalBallGraphEdgeCount: 0,
    goalBallWorkerJobCount: 0,
    goalBallExpandedPortCount: 0,
    goalBallRelaxationCount: 0,
    goalBallTableBytes: 0,
    goalBallMaximumSettledPorts: 0,
    goalBallLandmarkCount: 0,
    goalBallLandmarkRelaxationCount: 0,
  }
  ready = false
  readonly landmarkHeuristic: TinyLandmarkHeuristic
  private readonly problem: TinyHyperGraphProblem
  private readonly groups = new Map<string, TinyGoalBallGroup>()
  private readonly tables = new Map<string, Float64Array>()
  private readonly usablePortsByNet = new Map<number, Int8Array>()
  private readonly pendingGoals = new Map<string, Promise<void>>()
  private preparation?: Promise<void>

  constructor(solver: TinyGoalBallCostSolver, maximumSettledPorts = 2048) {
    if (!solver.goalBallScoresGeometricSegments || !Number.isInteger(maximumSettledPorts) || maximumSettledPorts < 1) {
      throw new Error("Goal-ball routing requires scored geometric segments and a positive search capacity")
    }
    this.problem = solver.problem
    this.maximumSettledPorts = maximumSettledPorts
    this.landmarkHeuristic = new TinyLandmarkHeuristic(solver)
    const { topology, problem } = solver
    const metric = this.landmarkHeuristic.graph
    const edgeRegionIds = new Int32Array(sharedBuffer(metric.targets.length * Int32Array.BYTES_PER_ELEMENT))
    const regionNetIds = new Int32Array(sharedBuffer(topology.regionCount * Int32Array.BYTES_PER_ELEMENT))
    regionNetIds.set(problem.regionNetId)
    for (let portId = 0; portId < topology.portCount; portId++) {
      let edge = metric.portOffsets[portId]!
      for (const regionId of topology.incidentPortRegion[portId]!) {
        for (const target of topology.regionIncidentPorts[regionId]!) {
          if (target !== portId) edgeRegionIds[edge++] = regionId
        }
      }
      if (edge !== metric.portOffsets[portId + 1]) throw new Error("Goal-ball region incidence is inconsistent")
    }
    this.graph = { ...metric, edgeRegionIds, regionNetIds, halfPenalties: this.landmarkHeuristic.halfPenalties }
    const reservations = solver.problemSetup.portEndpointReservationNetId
    for (const netId of problem.routeNet) {
      if (this.usablePortsByNet.has(netId)) continue
      const usable = new Int8Array(sharedBuffer(topology.portCount * Int8Array.BYTES_PER_ELEMENT))
      for (let portId = 0; portId < topology.portCount; portId++) {
        usable[portId] = problem.portSectionMask[portId] !== 0 &&
          (reservations[portId] === -1 || reservations[portId] === netId) ? 1 : 0
      }
      this.usablePortsByNet.set(netId, usable)
    }
    // Startup does not filter its own endpoint. Allow every endpoint of this
    // net, including ambiguous reservations, as a conservative relaxation.
    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      const usable = this.usablePortsByNet.get(problem.routeNet[routeId]!)!
      usable[problem.routeStartPort[routeId]!] = 1
      usable[problem.routeEndPort[routeId]!] = 1
    }
    for (const assignment of problem.initialAssignments ?? []) {
      const usable = this.usablePortsByNet.get(problem.routeNet[assignment.routeId]!)!
      usable[assignment.fromPortId] = 1
      usable[assignment.toPortId] = 1
    }
    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      this.group(problem.routeNet[routeId]!, problem.routeEndPort[routeId]!, problem.routeStartPort[routeId]!)
    }
    this.stats.goalBallGraphEdgeCount = metric.targets.length
    this.stats.goalBallMaximumSettledPorts = maximumSettledPorts
  }

  validateSolver(solver: TinyGoalBallCostSolver): void {
    if (solver.problem !== this.problem || !solver.goalBallScoresGeometricSegments) {
      throw new Error("Goal-ball heuristic is incompatible with this route search")
    }
    this.landmarkHeuristic.validateSolver(solver)
  }

  prepareLandmarks(workerPool?: ParallelStageWorkerPool): Promise<void> | undefined {
    const record = (): void => {
      this.stats.goalBallLandmarkCount = this.landmarkHeuristic.stats.landmarkCount
      this.stats.goalBallLandmarkRelaxationCount = this.landmarkHeuristic.stats.landmarkRelaxationCount
    }
    if (workerPool) return this.landmarkHeuristic.prepare(workerPool).then(record)
    this.landmarkHeuristic.prepareSync()
    record()
    return undefined
  }

  private group(netId: number, targetPortId: number, startPortId: number): TinyGoalBallGroup {
    const key = `${netId}:${targetPortId}`
    let group = this.groups.get(key)
    if (!group) {
      const usablePorts = this.usablePortsByNet.get(netId)
      if (!usablePorts) throw new Error("Goal-ball net is absent from the routing problem")
      group = { netId, targetPortId, startPortIds: [], usablePorts }
      this.groups.set(key, group)
    }
    const portCount = this.graph.portOffsets.length - 1
    if (!Number.isInteger(startPortId) || !Number.isInteger(targetPortId) ||
        startPortId < 0 || targetPortId < 0 || startPortId >= portCount || targetPortId >= portCount) {
      throw new Error("Goal-ball route endpoint is outside the graph")
    }
    if (!group.usablePorts[startPortId] || !group.usablePorts[targetPortId]) {
      const usable = new Int8Array(sharedBuffer(portCount * Int8Array.BYTES_PER_ELEMENT))
      usable.set(group.usablePorts)
      usable[startPortId] = 1
      usable[targetPortId] = 1
      group.usablePorts = usable
      this.tables.delete(key)
    }
    if (!group.startPortIds.includes(startPortId)) group.startPortIds.push(startPortId)
    return group
  }

  prepareSync(): void {
    if (this.ready) return
    if (this.preparation) throw new Error("Goal-ball worker preparation is already pending")
    this.prepareLandmarks()
    const groups = [...this.groups.values()]
    const result = executeParallelGoalBallJob({ kind: "pathingGoalBalls", graph: this.graph,
      groups, maximumSettledPorts: this.maximumSettledPorts })
    this.commit(result.groups, groups)
    this.stats.goalBallLandmarkCount = this.landmarkHeuristic.stats.landmarkCount
    this.stats.goalBallLandmarkRelaxationCount = this.landmarkHeuristic.stats.landmarkRelaxationCount
    this.ready = true
  }

  prepare(workerPool: ParallelStageWorkerPool): Promise<void> {
    if (this.ready) return Promise.resolve()
    if (!this.preparation) {
      const batches: TinyGoalBallGroup[][] = Array.from({ length: Math.min(4, this.groups.size) }, (): TinyGoalBallGroup[] => [])
      const groups = [...this.groups.values()]
      // Equal capped work is interleaved across the existing four workers.
      for (let index = 0; index < groups.length; index++) batches[index % batches.length]!.push(groups[index]!)
      this.stats.goalBallWorkerJobCount += batches.length
      const goalJobs = Promise.all(batches.map((batch): Promise<ParallelGoalBallWorkerResult> =>
        workerPool.run<ParallelGoalBallWorkerResult>({ kind: "pathingGoalBalls", graph: this.graph,
          groups: batch, maximumSettledPorts: this.maximumSettledPorts }),
      ))
      this.preparation = Promise.all([this.landmarkHeuristic.prepare(workerPool), goalJobs]).then(([, results]): void => {
        for (let index = 0; index < results.length; index++) {
          const result = results[index]!
          if (result.kind !== "pathingGoalBalls") throw new Error("Invalid goal-ball worker result")
          this.commit(result.groups, batches[index]!)
        }
        this.stats.goalBallLandmarkCount = this.landmarkHeuristic.stats.landmarkCount
        this.stats.goalBallLandmarkRelaxationCount = this.landmarkHeuristic.stats.landmarkRelaxationCount
        this.ready = true
      })
    }
    return this.preparation
  }

  ensureGoal(netId: number, targetPortId: number, startPortId: number,
    workerPool?: ParallelGoalBallWorkerPool): Promise<void> | undefined {
    if (!this.ready) throw new Error("Goal-ball dynamic target requires initial preparation")
    const key = `${netId}:${targetPortId}`
    const pending = this.pendingGoals.get(key)
    const existing = this.groups.get(key)
    if (pending && (!existing?.usablePorts[startPortId] || !existing.usablePorts[targetPortId])) {
      throw new Error("Goal-ball target mask changed during worker preparation")
    }
    const group = this.group(netId, targetPortId, startPortId)
    if (this.tables.has(key)) return undefined
    if (pending) return pending
    if (!workerPool) {
      this.commit(executeParallelGoalBallJob({ kind: "pathingGoalBalls", graph: this.graph,
        groups: [group], maximumSettledPorts: this.maximumSettledPorts }).groups, [group])
      return undefined
    }
    this.stats.goalBallWorkerJobCount++
    const promise = workerPool.run<ParallelGoalBallWorkerResult>({ kind: "pathingGoalBalls", graph: this.graph,
      groups: [group], maximumSettledPorts: this.maximumSettledPorts }).then((result): void => {
      if (result.kind !== "pathingGoalBalls") throw new Error("Invalid goal-ball worker result")
      this.commit(result.groups, [group])
      this.pendingGoals.delete(key)
    })
    this.pendingGoals.set(key, promise)
    return promise
  }

  private commit(results: TinyGoalBallBounds[], expectedGroups: TinyGoalBallGroup[]): void {
    if (results.length !== expectedGroups.length) throw new Error("Goal-ball worker returned incomplete groups")
    for (let index = 0; index < results.length; index++) {
      const result = results[index]!
      const expected = expectedGroups[index]!
      const key = `${result.netId}:${result.targetPortId}`
      if (result.netId !== expected.netId || result.targetPortId !== expected.targetPortId ||
          !this.groups.has(key) || result.bounds.length !== this.graph.portOffsets.length - 1 ||
          !Number.isInteger(result.expandedPortCount) || result.expandedPortCount < 0 ||
          result.expandedPortCount > this.maximumSettledPorts || !Number.isInteger(result.relaxationCount) ||
          result.relaxationCount < 0 || Number.isNaN(result.cutoff) || result.cutoff < 0) {
        throw new Error("Goal-ball worker returned invalid bounds or counters")
      }
      for (const bound of result.bounds) {
        if (Number.isNaN(bound) || bound < 0) throw new Error("Goal-ball worker returned an invalid bound")
      }
      this.tables.set(key, result.bounds)
      this.stats.goalBallExpandedPortCount += result.expandedPortCount
      this.stats.goalBallRelaxationCount += result.relaxationCount
    }
    this.stats.goalBallGroupCount = this.tables.size
    this.stats.goalBallTableBytes = [...this.tables.values()].reduce((sum, table): number => sum + table.byteLength, 0)
  }

  getBounds(netId: number, targetPortId: number): Float64Array {
    const bounds = this.tables.get(`${netId}:${targetPortId}`)
    if (!this.ready || !bounds) throw new Error("Goal-ball heuristic was used before target preparation completed")
    return bounds
  }
}
