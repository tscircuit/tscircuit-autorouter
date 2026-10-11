import { expect, test } from "bun:test"
import { TinyHyperGraphSolver, type TinyHyperGraphProblem, type TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { PackedDistanceAwareTinyHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedDistanceAwareTinyHyperGraphSolver"

type CostCounts = [number, number, number, number]
type CostCall = { regionId: number; counts: CostCounts; first: number; second: number; result: number }
type CostHost = { computeRegionCostForRegion: (regionId: number, ...counts: CostCounts) => number }
type RoutingCounters = {
  routeAttemptCountByRouteId: Uint32Array
  routeSuccessCountByRouteId: Uint32Array
  bestSolvedStateSummary?: unknown
  bestSolvedStateSnapshot?: unknown
}

function mutateCostConfiguration(solver: TinyHyperGraphSolver, regionId: number): void {
  const masks = solver.topology.regionAvailableZMask
  if (!masks) throw new Error("Callback fixture requires region layer masks")
  solver.minViaPadDiameter += 1 / 1024
  solver.TRACE_DENSITY_COST_FACTOR += 1 / 512
  solver.topology.regionWidth[regionId] += 1 / 256
  solver.topology.regionHeight[regionId] -= 1 / 512
  masks[regionId] ^= 32
}

class NativeCostCallbackSolver extends DistanceAwareTinyHyperGraphSolver {
  readonly costCalls: CostCall[] = []
  costError?: Error

  protected override computeRegionCostForRegion(regionId: number, same: number,
    cross: number, changes: number, count: number): number {
    const first = super.computeRegionCostForRegion(regionId, same, cross, changes, count)
    mutateCostConfiguration(this, regionId)
    const second = super.computeRegionCostForRegion(regionId, same, cross, changes, count)
    const result = second + first / 8 + 0.125
    this.costCalls.push({ regionId, counts: [same, cross, changes, count], first, second, result })
    if (this.costError) throw this.costError
    return result
  }
}

class PackedCostCallbackSolver extends PackedDistanceAwareTinyHyperGraphSolver {
  readonly costCalls: CostCall[] = []
  costError?: Error

  protected override computeRegionCostForRegion(regionId: number, same: number,
    cross: number, changes: number, count: number): number {
    const first = super.computeRegionCostForRegion(regionId, same, cross, changes, count)
    mutateCostConfiguration(this, regionId)
    const second = super.computeRegionCostForRegion(regionId, same, cross, changes, count)
    const result = second + first / 8 + 0.125
    this.costCalls.push({ regionId, counts: [same, cross, changes, count], first, second, result })
    if (this.costError) throw this.costError
    return result
  }
}

function createFixture(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  return {
    topology: {
      portCount: 8, regionCount: 4,
      incidentPortRegion: [[0], [0, 1], [0, 2], [1, 3], [2, 3], [3], [0], [3]],
      regionIncidentPorts: [[0, 6, 2, 1], [1, 3], [2, 4], [3, 5, 4, 7]],
      regionWidth: new Float64Array([3.25, 2.75, 2.25, 3.5]),
      regionHeight: new Float64Array([2.25, 2.5, 2.75, 2.125]),
      regionCenterX: new Float64Array([0, 1, 1, 2]),
      regionCenterY: new Float64Array([0, 1, -1, 0]),
      regionAvailableZMask: new Int32Array(4).fill(63),
      portX: new Float64Array([-1, 0.5, 0.5, 1.5, 1.5, 3, -1, 3]),
      portY: new Float64Array([0, 1, -1, 1, -1, 0, 0.25, 0.25]),
      portZ: new Int32Array([0, 0, 1, 0, 1, 0, 1, 1]),
      portAngleForRegion1: new Int32Array([0, 9000, -9000, 0, 0, 18000, 1000, 19000]),
      portAngleForRegion2: new Int32Array([0, 18000, 18000, 9000, -9000, 0, 0, 0]),
    },
    problem: {
      routeCount: 2, routeStartPort: new Int32Array([0, 6]),
      routeEndPort: new Int32Array([5, 7]), routeNet: new Int32Array([17, 23]),
      regionNetId: new Int32Array(4).fill(-1),
      portSectionMask: new Int8Array([1, 1, 1, 1, 1, 0, 1, 0]),
      portPenalty: new Float64Array([0, 0.03125, 0.0625, 0.125, 0.0625, 0, 0, 0]),
    },
  }
}

function readRoutingState(solver: NativeCostCallbackSolver | PackedCostCallbackSolver): unknown {
  const { candidateQueue, ...state } = solver.state
  const counters = solver as unknown as RoutingCounters
  return {
    iterations: solver.iterations, maxIterations: solver.MAX_ITERATIONS,
    solved: solver.solved, failed: solver.failed,
    error: solver.error?.replace(solver.constructor.name, "CostCallbackSolver"),
    progress: solver.progress, stats: solver.stats,
    state, queue: candidateQueue.toArray(), costCalls: solver.costCalls,
    routeAttempts: counters.routeAttemptCountByRouteId,
    routeSuccesses: counters.routeSuccessCountByRouteId,
    bestSummary: counters.bestSolvedStateSummary,
    bestSnapshot: counters.bestSolvedStateSnapshot,
    width: solver.topology.regionWidth, height: solver.topology.regionHeight,
    masks: solver.topology.regionAvailableZMask,
    minViaPadDiameter: solver.minViaPadDiameter, density: solver.TRACE_DENSITY_COST_FACTOR,
  }
}

function assertCallParity(native: NativeCostCallbackSolver, packed: PackedCostCallbackSolver): void {
  expect(packed.costCalls).toHaveLength(native.costCalls.length)
  for (let index = 0; index < native.costCalls.length; index++) {
    const expected = native.costCalls[index]!, actual = packed.costCalls[index]!
    expect(actual.regionId).toBe(expected.regionId)
    expect(actual.counts).toEqual(expected.counts)
    expect(Object.is(actual.first, expected.first)).toBeTrue()
    expect(Object.is(actual.second, expected.second)).toBeTrue()
    expect(Object.is(actual.result, expected.result)).toBeTrue()
  }
}

test("region-cost memo preserves virtual double-super callbacks, mutation, throws and native routing caps", (): void => {
  let completed = 0
  let capped = 0
  for (const maxIterations of [1, 300]) {
    const input = createFixture()
    const options = { MAX_ITERATIONS: maxIterations, STATIC_REACHABILITY_PRECHECK: false,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      minViaPadDiameter: 0.37, TRACE_DENSITY_COST_FACTOR: 0.5 }
    const native = new NativeCostCallbackSolver(structuredClone(input.topology), structuredClone(input.problem), options)
    const packed = new PackedCostCallbackSolver(structuredClone(input.topology), structuredClone(input.problem), options)
    expect(packed.regionCostMemo).toBeUndefined()
    const counts: CostCounts = [1.25, 0.5, 0.75, 2.25]
    const nativeHost = native as unknown as CostHost, packedHost = packed as unknown as CostHost
    for (let repetition = 0; repetition < 3; repetition++) {
      const expected = nativeHost.computeRegionCostForRegion(0, ...counts)
      const actual = packedHost.computeRegionCostForRegion(0, ...counts)
      expect(Object.is(actual, expected)).toBeTrue()
      expect(native.costCalls.at(-1)!.first).not.toBe(native.costCalls.at(-1)!.second)
      assertCallParity(native, packed)
    }
    const callbackError = new Error("custom region-cost callback failure")
    native.costError = packed.costError = callbackError
    for (let repetition = 0; repetition < 2; repetition++) {
      for (const solver of [native, packed]) {
        let thrown: unknown
        try {
          const host = solver as unknown as CostHost
          host.computeRegionCostForRegion(0, ...counts)
        } catch (error) {
          thrown = error
        }
        expect(thrown).toBe(callbackError)
        expect(solver.failed).toBeFalse()
      }
      assertCallParity(native, packed)
      expect(readRoutingState(packed)).toEqual(readRoutingState(native))
    }
    native.costError = packed.costError = undefined
    while (!native.solved && !native.failed) {
      if (native.iterations > 350) throw new Error("Callback fixture exceeded its native iteration budget")
      native.step()
      packed.step()
      expect(readRoutingState(packed)).toEqual(readRoutingState(native))
      assertCallParity(native, packed)
    }
    expect(packed.MAX_ITERATIONS).toBe(maxIterations)
    expect(packed.costCalls.length).toBeGreaterThan(5)
    expect(native.costCalls.some((call): boolean => call.counts[3] === 1)).toBeTrue()
    if (native.solved) completed++
    if (native.failed && native.iterations === native.MAX_ITERATIONS) capped++
  }
  const input = createFixture()
  const options = { MAX_ITERATIONS: 300, STATIC_REACHABILITY_PRECHECK: false,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, RIP_THRESHOLD_RAMP_ATTEMPTS: 0 }
  const native = new NativeCostCallbackSolver(structuredClone(input.topology), structuredClone(input.problem), options)
  const packed = new PackedCostCallbackSolver(structuredClone(input.topology), structuredClone(input.problem), options)
  const callbackError = new Error("region-cost callback thrown during native routing")
  native.costError = packed.costError = callbackError
  for (const solver of [native, packed]) {
    let thrown: unknown
    try {
      solver.step()
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(callbackError)
    expect(solver.failed).toBeTrue()
    expect(solver.iterations).toBe(1)
  }
  assertCallParity(native, packed)
  expect(readRoutingState(packed)).toEqual(readRoutingState(native))
  const getterInput = createFixture()
  const getterNative = new DistanceAwareTinyHyperGraphSolver(
    structuredClone(getterInput.topology), structuredClone(getterInput.problem), options,
  )
  const getterPacked = new PackedDistanceAwareTinyHyperGraphSolver(
    structuredClone(getterInput.topology), structuredClone(getterInput.problem), options,
  )
  const getterReads = [[0, 0], [0, 0]]
  const getterOrder: string[][] = [[], []]
  expect(getterPacked.regionCostMemo).toBeDefined()
  getterPacked.regionCostMemo!.collectDiagnostics = true
  for (const [index, solver] of [getterNative, getterPacked].entries()) {
    Object.defineProperty(solver, "minViaPadDiameter", {
      configurable: true,
      get: (): number => {
        getterReads[index]![0]++
        getterOrder[index]!.push("pad")
        if (getterReads[index]![0] === 1 || getterReads[index]![0] === 4) {
          solver.topology.regionWidth[0] += 1
        }
        return 0.37
      },
    })
    Object.defineProperty(solver, "TRACE_DENSITY_COST_FACTOR", {
      configurable: true,
      get: (): number => {
        getterReads[index]![1]++
        getterOrder[index]!.push("density")
        if (getterReads[index]![1] === 2 || getterReads[index]![1] === 7) {
          solver.topology.regionHeight[0] += 0.5
          solver.topology.regionAvailableZMask![0] ^= 32
        }
        return 0.5
      },
    })
  }
  const getterNativeHost = getterNative as unknown as CostHost
  const getterPackedHost = getterPacked as unknown as CostHost
  for (let repetition = 0; repetition < 12; repetition++) {
    const expected = getterNativeHost.computeRegionCostForRegion(0, 1, 0, 1, 2)
    const actual = getterPackedHost.computeRegionCostForRegion(0, 1, 0, 1, 2)
    expect(Object.is(actual, expected)).toBeTrue()
    expect(getterReads[1]).toEqual(getterReads[0])
    expect(getterOrder[1]).toEqual(getterOrder[0])
    expect(getterPacked.topology.regionWidth).toEqual(getterNative.topology.regionWidth)
    expect(getterPacked.topology.regionHeight).toEqual(getterNative.topology.regionHeight)
    expect(getterPacked.topology.regionAvailableZMask).toEqual(getterNative.topology.regionAvailableZMask)
  }
  expect(getterReads).toEqual([[12, 12], [12, 12]])
  expect(getterPacked.regionCostMemo!.diagnostics.hits).toBeGreaterThan(0)
  expect(getterPacked.regionCostMemo!.diagnostics.geometryInvalidations).toBeGreaterThan(0)
  expect(getterPacked.regionCostMemo!.diagnostics.unsupported).toBe(0)
  const prototypeInput = createFixture()
  const prototypeNative = new DistanceAwareTinyHyperGraphSolver(
    structuredClone(prototypeInput.topology), structuredClone(prototypeInput.problem), options,
  )
  const prototypePacked = new PackedDistanceAwareTinyHyperGraphSolver(
    structuredClone(prototypeInput.topology), structuredClone(prototypeInput.problem), options,
  )
  const nativePrototype = TinyHyperGraphSolver.prototype as unknown as CostHost
  const originalCost = nativePrototype.computeRegionCostForRegion
  const prototypeNativeHost = prototypeNative as unknown as CostHost
  const prototypePackedHost = prototypePacked as unknown as CostHost
  prototypePacked.regionCostMemo!.collectDiagnostics = true
  prototypePackedHost.computeRegionCostForRegion(0, 1, 0, 1, 2)
  const beforeCustom = { ...prototypePacked.regionCostMemo!.diagnostics }
  let customCalls = 0
  let customError: Error | undefined
  try {
    nativePrototype.computeRegionCostForRegion = function (regionId: number, ...counts: CostCounts): number {
      customCalls++
      const cost = originalCost.call(this, regionId, ...counts)
      if (customError) throw customError
      return cost + 0.125
    }
    for (let repetition = 0; repetition < 4; repetition++) {
      expect(Object.is(prototypePackedHost.computeRegionCostForRegion(0, 1, 0, 1, 2),
        prototypeNativeHost.computeRegionCostForRegion(0, 1, 0, 1, 2))).toBeTrue()
    }
    customError = new Error("replaced native region-cost prototype")
    for (const host of [prototypeNativeHost, prototypePackedHost]) {
      let thrown: unknown
      try { host.computeRegionCostForRegion(0, 1, 0, 1, 2) }
      catch (error) { thrown = error }
      expect(thrown).toBe(customError)
    }
    expect(customCalls).toBe(10)
    expect(prototypePacked.regionCostMemo!.diagnostics).toEqual(beforeCustom)
  } finally {
    nativePrototype.computeRegionCostForRegion = originalCost
  }
  expect(Object.is(prototypePackedHost.computeRegionCostForRegion(0, 1, 0, 1, 2),
    prototypeNativeHost.computeRegionCostForRegion(0, 1, 0, 1, 2))).toBeTrue()
  expect(prototypePacked.regionCostMemo!.diagnostics.hits).toBe(beforeCustom.hits + 1)
  expect(completed).toBe(1)
  expect(capped).toBe(1)
})
