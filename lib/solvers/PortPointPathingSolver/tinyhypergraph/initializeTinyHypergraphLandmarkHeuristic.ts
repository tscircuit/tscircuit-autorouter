import {
  DistanceAwareTinyHyperGraphSolver,
  type TinyHyperGraphSolver,
} from "tiny-hypergraph/lib/index"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"

type Landmark = {
  portId: number
  from: Float64Array
  to: Float64Array
}

export type LandmarkHeuristicStats = {
  initialAltLandmarkCount: number
  initialAltRelaxedArcCount: number
  initialAltScannedArcCount: number
  initialAltPreprocessingMs: number
  initialAltRelaxedInfinitePenaltyPortCount: number
  initialAltQueryCount: number
  initialAltCacheHitCount: number
  initialAltMaxImprovementOverEuclidean: number
  initialAltActive: boolean
}

export type LandmarkHeuristicController = {
  evaluateBound: (portId: number, goalPortId: number) => number
  uninstall: () => void
  getStats: () => LandmarkHeuristicStats
}

/**
 * Initialize a consistent directed ALT lower bound for distance-aware A*.
 * Relaxed arcs connect any two ports incident to a common region. They charge
 * geometric distance, arrival-port penalty and only the empty-region kernel
 * increment. Actual hop restrictions, ownership and congestion are relaxed.
 * Four coordinate extrema bound preprocessing independently of route count.
 */
export const initializeTinyHypergraphLandmarkHeuristic = (
  solver: TinyHyperGraphSolver,
): LandmarkHeuristicController => {
  if (!(solver instanceof DistanceAwareTinyHyperGraphSolver)) {
    throw new Error("Landmark heuristics require native segment distance in g")
  }
  if (
    solver.iterations !== 0 ||
    solver.state.currentRouteId !== undefined ||
    solver.state.ripCount !== 0
  ) {
    throw new Error("Landmark heuristics initialize an unstarted solver")
  }
  const started = performance.now()
  const { topology, problem } = solver
  const distanceFactor = solver.DISTANCE_TO_COST
  if (!Number.isFinite(distanceFactor) || distanceFactor < 0) {
    throw new Error("Invalid nonnegative distance factor")
  }
  const portCount = topology.portCount
  const penalties = new Float64Array(portCount)
  let relaxedInfinitePenaltyPortCount = 0
  for (let portId = 0; portId < portCount; portId++) {
    const penalty = problem.portPenalty?.[portId] ?? 0
    if (Number.isNaN(penalty) || penalty < 0) {
      throw new Error(`Invalid nonnegative penalty at port ${portId}`)
    }
    // Infinite native penalties are relaxed to zero, retaining finite arcs in
    // both directions within each component. Native computeG still rejects them.
    if (penalty === Number.POSITIVE_INFINITY) {
      relaxedInfinitePenaltyPortCount++
    } else {
      penalties[portId] = penalty
    }
    if (
      !Number.isFinite(topology.portX[portId]) ||
      !Number.isFinite(topology.portY[portId])
    ) {
      throw new Error(`Nonfinite coordinates at port ${portId}`)
    }
  }
  const sameLayerCosts = new Float64Array(topology.regionCount)
  const changedLayerCosts = new Float64Array(topology.regionCount)
  let relaxedArcCount = 0
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const regionCost = (changes: number, traces: number): number =>
      computeRegionCost(
        topology.regionWidth[regionId]!,
        topology.regionHeight[regionId]!,
        0,
        0,
        changes,
        traces,
        topology.regionAvailableZMask?.[regionId] ?? 0,
        solver.minViaPadDiameter,
        solver.TRACE_DENSITY_COST_FACTOR,
      )
    const emptyCost = regionCost(0, 0)
    sameLayerCosts[regionId] = regionCost(0, 1) - emptyCost
    changedLayerCosts[regionId] = regionCost(1, 1) - emptyCost
    if (
      !Number.isFinite(sameLayerCosts[regionId]) ||
      sameLayerCosts[regionId]! < 0 ||
      !Number.isFinite(changedLayerCosts[regionId]) ||
      changedLayerCosts[regionId]! < 0
    ) {
      throw new Error(`Invalid nonnegative static cost in region ${regionId}`)
    }
    const count = topology.regionIncidentPorts[regionId]!.length
    relaxedArcCount += count * (count - 1)
  }
  const extremePorts: number[] = []
  for (const coordinates of [topology.portX, topology.portY]) {
    let minimum = -1
    let maximum = -1
    for (let portId = 0; portId < portCount; portId++) {
      if (minimum === -1 || coordinates[portId]! < coordinates[minimum]!) {
        minimum = portId
      }
      if (maximum === -1 || coordinates[portId]! > coordinates[maximum]!) {
        maximum = portId
      }
    }
    if (minimum !== -1) extremePorts.push(minimum, maximum)
  }
  let scannedArcCount = 0
  const distances = (origin: number, reverse: boolean): Float64Array => {
    const costs = new Float64Array(portCount).fill(Number.POSITIVE_INFINITY)
    const positions = new Int32Array(portCount).fill(-1)
    const heap = new Int32Array(portCount)
    let heapLength = 0
    const less = (left: number, right: number): boolean =>
      costs[left]! < costs[right]! ||
      (costs[left] === costs[right] && left < right)
    const swap = (left: number, right: number): void => {
      const temporary = heap[left]!
      heap[left] = heap[right]!
      heap[right] = temporary
      positions[heap[left]!] = left
      positions[heap[right]!] = right
    }
    const decrease = (portId: number): void => {
      let index = positions[portId]!
      if (index === -1) {
        index = heapLength++
        heap[index] = portId
        positions[portId] = index
      }
      while (index > 0) {
        const parent = (index - 1) >>> 1
        if (!less(heap[index]!, heap[parent]!)) break
        swap(index, parent)
        index = parent
      }
    }
    const dequeue = (): number => {
      const result = heap[0]!
      heapLength--
      positions[result] = -2
      if (heapLength > 0) {
        heap[0] = heap[heapLength]!
        positions[heap[0]!] = 0
        let index = 0
        while (index * 2 + 1 < heapLength) {
          let child = index * 2 + 1
          if (child + 1 < heapLength && less(heap[child + 1]!, heap[child]!)) {
            child++
          }
          if (!less(heap[child]!, heap[index]!)) break
          swap(index, child)
          index = child
        }
      }
      return result
    }
    costs[origin] = 0
    decrease(origin)
    while (heapLength > 0) {
      const portId = dequeue()
      for (const regionId of topology.incidentPortRegion[portId]!) {
        for (const neighborPortId of topology.regionIncidentPorts[regionId]!) {
          if (neighborPortId === portId) continue
          scannedArcCount++
          if (positions[neighborPortId] === -2) continue
          const dx = topology.portX[portId]! - topology.portX[neighborPortId]!
          const dy = topology.portY[portId]! - topology.portY[neighborPortId]!
          const distance = Math.sqrt(dx * dx + dy * dy)
          const emptyIncrement =
            topology.portZ[portId] === topology.portZ[neighborPortId]
              ? sameLayerCosts[regionId]!
              : changedLayerCosts[regionId]!
          const nextCost =
            costs[portId]! +
            distance * distanceFactor +
            emptyIncrement +
            penalties[reverse ? portId : neighborPortId]!
          if (nextCost < costs[neighborPortId]!) {
            costs[neighborPortId] = nextCost
            decrease(neighborPortId)
          }
        }
      }
    }
    return costs
  }
  const landmarks: Landmark[] = [...new Set(extremePorts)].map(
    (portId): Landmark => ({
      portId,
      from: distances(portId, false),
      to: distances(portId, true),
    }),
  )
  const preprocessingMs = performance.now() - started
  const originalComputeH = solver.computeH
  let active = true
  let queryCount = 0
  let cacheHitCount = 0
  let maxImprovement = 0
  let cachedGoalPortId = -1
  let generation = 0
  const generationByPort = new Uint32Array(portCount)
  const boundByPort = new Float64Array(portCount)
  const getStats = (): LandmarkHeuristicStats => ({
    initialAltLandmarkCount: landmarks.length,
    initialAltRelaxedArcCount: relaxedArcCount,
    initialAltScannedArcCount: scannedArcCount,
    initialAltPreprocessingMs: preprocessingMs,
    initialAltRelaxedInfinitePenaltyPortCount: relaxedInfinitePenaltyPortCount,
    initialAltQueryCount: queryCount,
    initialAltCacheHitCount: cacheHitCount,
    initialAltMaxImprovementOverEuclidean: maxImprovement,
    initialAltActive: active,
  })
  const evaluateBound = (portId: number, goalPortId: number): number => {
    if (
      !Number.isInteger(portId) ||
      portId < 0 ||
      portId >= portCount ||
      !Number.isInteger(goalPortId) ||
      goalPortId < 0 ||
      goalPortId >= portCount
    ) {
      throw new Error("Landmark heuristic requires valid current and goal ports")
    }
    queryCount++
    if (cachedGoalPortId !== goalPortId) {
      cachedGoalPortId = goalPortId
      if (generation === 0xffffffff) {
        generationByPort.fill(0)
        generation = 1
      } else {
        generation++
      }
    }
    if (generationByPort[portId] === generation) {
      cacheHitCount++
      return boundByPort[portId]!
    }
    const dx = topology.portX[portId]! - topology.portX[goalPortId]!
    const dy = topology.portY[portId]! - topology.portY[goalPortId]!
    const euclidean = Math.sqrt(dx * dx + dy * dy) * distanceFactor
    let bound = euclidean
    for (const landmark of landmarks) {
      const fromPort = landmark.from[portId]!
      const fromGoal = landmark.from[goalPortId]!
      const toPort = landmark.to[portId]!
      const toGoal = landmark.to[goalPortId]!
      // Finite arcs are bidirectional within each relaxed component. For a
      // disconnected landmark both endpoint distances have the same status,
      // so omitting that term preserves consistency and avoids Infinity−Infinity.
      if (Number.isFinite(fromPort) && Number.isFinite(fromGoal)) {
        bound = Math.max(bound, fromGoal - fromPort)
      }
      if (Number.isFinite(toPort) && Number.isFinite(toGoal)) {
        bound = Math.max(bound, toPort - toGoal)
      }
    }
    generationByPort[portId] = generation
    boundByPort[portId] = bound
    maxImprovement = Math.max(maxImprovement, bound - euclidean)
    return bound
  }
  const uninstall = (): void => {
    if (!active) return
    active = false
    solver.computeH = originalComputeH
    solver.stats = { ...solver.stats, ...getStats() }
  }
  solver.computeH = (portId: number): number => {
    const bound = evaluateBound(portId, solver.state.goalPortId)
    // Preserve query counters in the normal final solver stats. The returned
    // controller also exposes the complete immutable preprocessing metrics.
    solver.stats.initialAltQueryCount = queryCount
    solver.stats.initialAltCacheHitCount = cacheHitCount
    solver.stats.initialAltMaxImprovementOverEuclidean = maxImprovement
    return bound
  }
  solver.stats = { ...solver.stats, ...getStats() }
  return { evaluateBound, uninstall, getStats }
}
