import { expect, test } from "bun:test"
import type { Candidate, TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"
import { TinyRegionScoringKernel } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/TinyRegionScoringKernel"

type Host = any
function fixture(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  return {
    topology: { portCount: 10, regionCount: 2,
      incidentPortRegion: Array.from({ length: 10 }, () => [0, 1]),
      regionIncidentPorts: [Array.from({ length: 10 }, (_, port) => port), Array.from({ length: 10 }, (_, port) => port)],
      regionWidth: new Float64Array([3, 2]), regionHeight: new Float64Array([4, 2]),
      regionCenterX: new Float64Array(2), regionCenterY: new Float64Array(2), regionAvailableZMask: new Int32Array([3, 3]),
      portX: Float64Array.from({ length: 10 }, (_, port) => port / 10), portY: new Float64Array(10),
      portZ: new Int32Array([0, 0, 1, 0, 2, 1, 0, 0, 1, 0]),
      portAngleForRegion1: new Int32Array([0, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
      portAngleForRegion2: new Int32Array([900, 800, 700, 600, 500, 400, 300, 200, 100, 0]) },
    problem: { routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([9]),
      routeNet: new Int32Array([3]), regionNetId: new Int32Array(2).fill(-1),
      portSectionMask: new Int8Array(10).fill(1), portPenalty: new Float64Array(10) },
  }
}
function memoState(solver: Host): unknown {
  const memo = solver.regionCostMemo, result: Host = {}
  for (const [name, value] of Object.entries(memo)) {
    if (name === "solver" || name === "nativeCost") continue
    result[name] = ArrayBuffer.isView(value) ? (value as Float64Array).slice() : value && typeof value === "object" ? structuredClone(value) : value
  }
  return result
}

test("pure bulk tuples preserve native memo LRU, scratch and goal state only for consumed visitors", (): void => {
  const left = fixture(), right = fixture(), options = { STATIC_REACHABILITY_PRECHECK: false, MAX_ITERATIONS: 100 }
  const native: Host = new TinyIndexedSelectiveReripHyperGraphSolver(left.topology, left.problem, options)
  const candidate: Host = new TinyIndexedSelectiveReripHyperGraphSolver(right.topology, right.problem, options)
  native.setup(); candidate.setup()
  const kernel = new TinyRegionScoringKernel({ firstRegion: candidate.candidateFirstRegionByPortId,
    secondRegion: candidate.candidateSecondRegionByPortId, angle1: right.topology.portAngleForRegion1,
    angle2: right.topology.portAngleForRegion2, z: right.topology.portZ, penalty: right.problem.portPenalty }, 32, 16)
  const neighbors = new Int32Array([1, 2, 3, 1, 4, 5, 6, 7, 2, 8, 9, 5, 1, 7]),
    distances = Float64Array.from(neighbors, (port) => port / 10), maximumCosts = new Float64Array(neighbors.length).fill(Infinity)
  const memoAlias = candidate.regionCostMemo.rows, scratchAlias = candidate.segmentGeometryScratch
  let visited = 0, skipped = 0, goals = 0
  for (let round = 0; round < 100; round++) {
    const count = round % 8, region = round % 2
    const cache = { netIds: Int32Array.from({ length: count }, (_, i) => i % 3 === 0 ? 3 : i),
      lesserAngles: Int32Array.from({ length: count }, (_, i) => (i + 1) * 75),
      greaterAngles: Int32Array.from({ length: count }, (_, i) => 900 - i * 25),
      layerMasks: Int32Array.from({ length: count }, (_, i) => 1 << (i % 3)),
      existingSameLayerIntersections: round % 4, existingCrossingLayerIntersections: round % 3,
      existingEntryExitLayerChanges: round % 5, existingSegmentCount: count,
      existingRegionCost: round % 2 === 0 ? 5 : 0 }
    for (const solver of [native, candidate]) {
      solver.state.currentRouteId = 0; solver.state.currentRouteNetId = 3; solver.state.goalPortId = 9
      solver.state.regionIntersectionCaches[region] = structuredClone(cache)
      solver.state.regionCongestionCost[region] = round % 3 / 20
      solver.minViaPadDiameter = round % 2 === 0 ? 0.3 : 0.4
      solver.TRACE_DENSITY_COST_FACTOR = round % 4 / 10; solver.DISTANCE_TO_COST = 0.05
      solver.topology.regionWidth[region] = 2 + round % 7; solver.topology.regionAvailableZMask[region] = round % 7 === 0 ? 1 : 7
      solver.regionCostMemo.collectDiagnostics = true
    }
    const current: Candidate = { portId: 0, nextRegionId: region, g: 0, h: 0, f: 0 }
    const beforeMemo = memoState(candidate), beforeScratch = { ...candidate.segmentGeometryScratch }
    const batch = kernel.score({ region, sourcePort: 0, currentNet: 3, neighbors, distances, maximumCosts,
      candidateG: current.g, congestion: candidate.state.regionCongestionCost[region], distanceScale: candidate.DISTANCE_TO_COST,
      width: candidate.topology.regionWidth[region], height: candidate.topology.regionHeight[region],
      availableLayers: candidate.topology.regionAvailableZMask[region], padDiameter: candidate.minViaPadDiameter,
      densityFactor: candidate.TRACE_DENSITY_COST_FACTOR, cache })
    expect(memoState(candidate)).toEqual(beforeMemo)
    expect(candidate.segmentGeometryScratch).toEqual(beforeScratch)
    const best = new Float64Array(10).fill(Infinity)
    for (let row = 0; row < neighbors.length; row++) {
      const port = neighbors[row]!
      if (port === 9) {
        goals++
        native.onPathFound(current); candidate.onPathFound(current)
        expect(memoState(candidate)).toEqual(memoState(native))
        expect(candidate.segmentGeometryScratch).toEqual(native.segmentGeometryScratch)
        expect(candidate.state.candidateQueue.toArray()).toEqual(native.state.candidateQueue.toArray())
        break
      }
      const penalty = right.problem.portPenalty![port]!, congestion = candidate.state.regionCongestionCost[region], distanceCost = distances[row]! * candidate.DISTANCE_TO_COST
      const lower = current.g + congestion + penalty + distanceCost
      if (current.g >= best[port]! || lower >= best[port]!) { skipped++; continue }
      visited++
      const originalG = native.computeG(current, port, best[port], distances[row])
      if (batch.flags[row]! & 1) Object.assign(candidate.segmentGeometryScratch, {
        netId: 3, lesserAngle: batch.lesser[row], greaterAngle: batch.greater[row], layerMask: batch.layers[row],
        entryExitLayerChanges: batch.changes[row], sameLayerIntersectionCount: batch.same[row], crossingLayerIntersectionCount: batch.cross[row] })
      let bulkG = Infinity
      if (batch.flags[row]! & 2) {
        // The original memo call happens only here, after the live best check.
        // Bulk computation alone never changes its four rows or LRU ordering.
        const cost = candidate.computeRegionCostForRegion(region, cache.existingSameLayerIntersections + batch.same[row]!,
          cache.existingCrossingLayerIntersections + batch.cross[row]!, cache.existingEntryExitLayerChanges + batch.changes[row]!,
          cache.existingSegmentCount + 1)
        bulkG = current.g + (cost - cache.existingRegionCost) + congestion + penalty + distanceCost
      }
      expect(Object.is(bulkG, originalG)).toBe(true)
      expect(memoState(candidate)).toEqual(memoState(native))
      expect(candidate.segmentGeometryScratch).toEqual(native.segmentGeometryScratch)
      if (Number.isFinite(originalG) && originalG < best[port]!) best[port] = originalG
    }
    expect(candidate.regionCostMemo.rows).toBe(memoAlias)
    expect(candidate.segmentGeometryScratch).toBe(scratchAlias)
  }
  expect(visited).toBeGreaterThan(500)
  expect(skipped).toBeGreaterThan(25)
  expect(goals).toBe(100)
  expect(candidate.regionCostMemo.diagnostics.hits).toBeGreaterThan(0)
  expect(candidate.regionCostMemo.diagnostics.misses).toBeGreaterThan(0)
})
