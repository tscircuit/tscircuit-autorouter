import { expect, test } from "bun:test"
import type { TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { DistanceAwareTinyHyperGraphSolver } from "tiny-hypergraph/lib/distance-aware-tiny-hypergraph-solver"
import { PackedDistanceAwareTinyHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/PackedDistanceAwareTinyHyperGraphSolver"

function fixture(): { topology: TinyHyperGraphTopology; problem: TinyHyperGraphProblem } {
  return {
    topology: {
      portCount: 9, regionCount: 5,
      incidentPortRegion: [[0], [0, 1], [0, 2], [0, 3], [1, 4], [2, 4], [4], [0, 4], [0]],
      regionIncidentPorts: [[3, 2, 8, 0, 7, 1, 2], [4, 1], [2, 5], [3], [5, 6, 4, 7]],
      regionWidth: new Float64Array(5).fill(3.25), regionHeight: new Float64Array(5).fill(2.25),
      regionCenterX: new Float64Array([0.5, 1.5, 1.5, 0.5, 2.5]), regionCenterY: new Float64Array([0, 1, -1, 0, 0]),
      portX: new Float64Array([0, 1, 1, 1, 2, 2, 3, 1, 0.5]), portY: new Float64Array([0, 1, -1, 0, 1, -1, 0, 0, 0]),
      portZ: new Int32Array(9), portAngleForRegion1: new Int32Array([0, 9000, -9000, 1000, 0, 0, 18000, 18000, 4000]),
      portAngleForRegion2: new Int32Array([0, 18000, 18000, 18000, 9000, -9000, 0, 0, 0]),
    },
    problem: { routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([6]),
      routeNet: new Int32Array([17]), regionNetId: new Int32Array(5).fill(-1), portSectionMask: new Int8Array(9).fill(1) },
  }
}

type Solver = DistanceAwareTinyHyperGraphSolver
function state(solver: Solver): unknown {
  const { candidateQueue, ...rest } = solver.state
  return { rest, queue: candidateQueue.toArray() }
}

function startSearch(solver: Solver, allowFirst: boolean): void {
  const internal = solver as unknown as {
    _setup(): void;
    resetCandidateBestCosts(): void; setCandidateBestCost(hop: number, cost: number): void;
    getHopId(port: number, region: number): number
  }
  internal._setup()
  internal.resetCandidateBestCosts()
  solver.state.currentRouteId = 0
  solver.state.currentRouteNetId = 17
  solver.state.goalPortId = 6
  solver.state.unroutedRoutes = []
  solver.state.regionCongestionCost[0] = 2
  for (const [port, region] of [[3, 3], [2, 2], [8, 0], [7, 4], [1, 1]]) {
    internal.setCandidateBestCost(internal.getHopId(port!, region!), allowFirst && port === 3 ? Infinity : 1)
  }
  const hop = internal.getHopId(0, 0)
  internal.setCandidateBestCost(hop, 0)
  solver.state.candidateQueue.clear()
  solver.state.candidateQueue.queue({ hopId: hop, nextRegionId: 0, portId: 0, g: 0, h: 0, f: 0 })
}

test("opt-in base distance pruning preserves native callbacks, policy accessors, exceptions, NaN paths and caps", (): void => {
  const originalSqrt = Math.sqrt
  const originalIsFinite = Number.isFinite
  const originalDescriptor = Object.getOwnPropertyDescriptor
  const sentinel = new RangeError("policy getter failed")
  let provedRejectChecks = 0
  try {
    for (const mode of ["plain", "zero", "negative", "nan-policy", "nan-coordinate", "accessor", "throw", "installed-accessor", "installed-finite", "sqrt-accessor"] as const) {
      const outputs: Array<{ events: unknown[]; state: unknown; exception: unknown }> = []
      for (const packed of [false, true]) {
        const input = fixture()
        const options = { MAX_ITERATIONS: 30, STATIC_REACHABILITY_PRECHECK: false, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false }
        const solver: Solver = packed
          ? new PackedDistanceAwareTinyHyperGraphSolver(input.topology, input.problem, { ...options, enableConservativeDistanceBound: true })
          : new DistanceAwareTinyHyperGraphSolver(input.topology, input.problem, options)
        const events: unknown[] = []
        const nativeG = solver.computeG.bind(solver)
        let installed = false
        const getter = (): number => {
          events.push("policy")
          if (mode === "throw") throw sentinel
          if (mode === "installed-accessor") {
            Math.sqrt = (value: number): number => { events.push("sqrt"); return originalSqrt(value) }
          }
          return 0.05
        }
        solver.computeG = (...args): number => {
          events.push(["g", args[0].portId, args[1], args[2], args[3]])
          if (mode === "installed-accessor" && !installed) {
            installed = true
            Object.defineProperty(solver, "DISTANCE_TO_COST", { configurable: true, get: getter })
          }
          if (mode === "installed-finite" && !installed) {
            installed = true
            Number.isFinite = (value: unknown): boolean => {
              events.push(["finite", value])
              return originalIsFinite(value)
            }
          }
          return nativeG(...args)
        }
        startSearch(solver, mode === "installed-accessor" || mode === "installed-finite")
        if (mode === "zero") solver.DISTANCE_TO_COST = 0
        if (mode === "negative") solver.DISTANCE_TO_COST = -1
        if (mode === "nan-policy") solver.DISTANCE_TO_COST = Number.NaN
        if (mode === "nan-coordinate") solver.topology.portX[2] = Number.NaN
        if (mode === "accessor" || mode === "throw") {
          Object.defineProperty(solver, "DISTANCE_TO_COST", { configurable: true, get: getter })
          Math.sqrt = (value: number): number => { events.push("sqrt"); return originalSqrt(value) }
        }
        if (mode === "sqrt-accessor") {
          Object.defineProperty(Math, "sqrt", { configurable: true, get: () => {
            events.push("sqrt-read")
            return originalSqrt
          } })
        }
        Object.getOwnPropertyDescriptor = (object, property) => {
          if (object === solver && property === "DISTANCE_TO_COST" && mode === "plain") provedRejectChecks++
          return originalDescriptor(object, property)
        }
        let exception: unknown
        try { solver._step() } catch (error) { exception = error }
        outputs.push({ events, state: state(solver), exception })
        Object.getOwnPropertyDescriptor = originalDescriptor
        Number.isFinite = originalIsFinite
        Object.defineProperty(Math, "sqrt", { configurable: true, writable: true, value: originalSqrt })
      }
      expect(outputs[1]).toEqual(outputs[0])
      if (mode === "throw") expect(outputs[1]!.exception).toBe(sentinel)
      if (mode === "nan-coordinate" || mode === "nan-policy") {
        expect(outputs[1]!.events.some((event) => Array.isArray(event) && event[0] === "g")).toBe(true)
      }
    }
    expect(provedRejectChecks).toBeGreaterThan(0)
    for (const max of [2, 100]) {
      const input = fixture()
      const options = { MAX_ITERATIONS: max, STATIC_REACHABILITY_PRECHECK: false, ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false }
      const native = new DistanceAwareTinyHyperGraphSolver(structuredClone(input.topology), structuredClone(input.problem), options)
      const packed = new PackedDistanceAwareTinyHyperGraphSolver(structuredClone(input.topology), structuredClone(input.problem),
        { ...options, enableConservativeDistanceBound: true })
      while (!native.solved && !native.failed) {
        native.step()
        packed.step()
        expect(state(packed)).toEqual(state(native))
        expect([packed.iterations, packed.solved, packed.failed]).toEqual([native.iterations, native.solved, native.failed])
      }
    }
  } finally {
    Object.getOwnPropertyDescriptor = originalDescriptor
    Number.isFinite = originalIsFinite
    Object.defineProperty(Math, "sqrt", { configurable: true, writable: true, value: originalSqrt })
  }
})
