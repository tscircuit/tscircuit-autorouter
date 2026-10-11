import { expect, test } from "bun:test"
import type { Candidate, TinyHyperGraphProblem, TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { TinyIndexedSelectiveReripHyperGraphSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyIndexedSelectiveReripHyperGraphSolver"
import { captureTinyKernelFactoryMethods, registerOwnedTinyKernelInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/pathingWasm/createTinyOrderedNeighborKernel"

const methods = captureTinyKernelFactoryMethods(TinyIndexedSelectiveReripHyperGraphSolver.prototype)

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
    problem: {
      routeCount: 1, routeStartPort: new Int32Array([0]), routeEndPort: new Int32Array([6]),
      routeNet: new Int32Array([17]), regionNetId: new Int32Array(5).fill(-1),
      portSectionMask: new Int8Array([1, 1, 1, 0, 1, 1, 0, 0, 1]),
      portPenalty: new Float64Array([0, 3, 3, 5, 1, 1, 7, 0, 0]),
    },
  }
}

function path(candidate: Candidate): number[] {
  const result: number[] = []
  for (let current: Candidate | undefined = candidate; current; current = current.prevCandidate)
    result.push(current.hopId!, current.prevRegionId ?? -1, current.nextRegionId, current.portId,
      current.g, current.h, current.f)
  return result
}

function observe(solver: TinyIndexedSelectiveReripHyperGraphSolver): unknown {
  const { candidateQueue, ...state } = solver.state
  const hidden = solver as unknown as { routeAttemptCountByRouteId: unknown;
    routeSuccessCountByRouteId: unknown; bestSolvedStateSummary: unknown }
  return {
    iterations: solver.iterations, solved: solver.solved, failed: solver.failed, error: solver.error,
    state, queue: candidateQueue.toArray().map(path), stats: solver.stats,
    attempts: hidden.routeAttemptCountByRouteId, successes: hidden.routeSuccessCountByRouteId,
    selective: solver.getSelectiveReripStats(), best: hidden.bestSolvedStateSummary,
  }
}

type Host = { wasmNeighborKernel?: { diagnostics: {
  batches: number; disabledReason: string
} } }

test("owned WASM routing retains native prefixes, aliases, generations and custom observer behavior", (): void => {
  const options = { MAX_ITERATIONS: 100, STATIC_REACHABILITY_PRECHECK: false,
    TRACE_DENSITY_COST_FACTOR: 0.75, DISTANCE_TO_COST: 0.17,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false, PARTIAL_RIP_MIN_ROUTE_COUNT: 0 }
  const variants = ["native", "wrap", "assignment", "generation", "computeG", "computeH", "policy", "partialRip",
    "congestion", "Math.sqrt", "Math.max", "Map.has", "Map.get", "typed.fill", "typed.set", "costMemo"] as const
  for (const variant of variants) {
    const left = fixture(), right = fixture()
    registerOwnedTinyKernelInput(right.topology, right.problem, methods)
    const original = new TinyIndexedSelectiveReripHyperGraphSolver(left.topology, left.problem, options)
    const packed = new TinyIndexedSelectiveReripHyperGraphSolver(right.topology, right.problem, options)
    const hosts = [original, packed]
    for (const solver of hosts) solver._setup()
    const bestAlias = packed.state.candidateBestCostByHopId
    const bestGenerationAlias = packed.state.candidateBestCostGenerationByHopId
    const assignmentAlias = packed.state.portAssignment
    const nativeAssignmentAlias = original.state.portAssignment
    const xAlias = packed.topology.portX
    const reads: number[][] = [[], []]
    let activeHost = -1
    let restore: (() => void) | undefined
    if (variant === "wrap") for (const solver of hosts) {
      solver.state.candidateBestCostGeneration = 0xffffffff
      solver.setCandidateBestCost(solver.getHopId(2, 2), -123)
    }
    if (variant === "assignment") for (const solver of hosts) {
      solver.state.portAssignment = new Int32Array(solver.state.portAssignment)
      solver.state.portAssignment[1] = 91
    }
    if (variant === "generation") for (const solver of hosts) solver.state.candidateQueue.clear()
    if (variant === "computeG") for (let index = 0; index < hosts.length; index++) {
      const solver = hosts[index]!, native = solver.computeG
      solver.computeG = function (...args): number {
        reads[index]!.push(args[1]); this.topology.portX[1] = 12
        return native.apply(this, args)
      }
    }
    if (variant === "computeH") for (let index = 0; index < hosts.length; index++) {
      const solver = hosts[index]!, native = solver.computeH
      solver.computeH = function (port): number {
        reads[index]!.push(port); this.topology.portX[1] = 12
        return native.call(this, port)
      }
    }
    if (variant === "policy" || variant === "partialRip" || variant === "congestion") {
      const name = variant === "policy" ? "DISTANCE_TO_COST" : variant === "partialRip" ? "PARTIAL_RIP_ENABLED" : "regionCongestionCost"
      for (let index = 0; index < hosts.length; index++) {
        const solver = hosts[index]!, target = variant === "congestion" ? solver.state : solver
        let value = (target as any)[name]
        Object.defineProperty(target, name, { configurable: true, get(): unknown {
          reads[index]!.push(1); solver.topology.portX[1] = 12; return value
        }, set(next: unknown): void { value = next } })
      }
    }
    if (variant === "costMemo") for (let index = 0; index < hosts.length; index++) {
      const solver = hosts[index]!, memo = solver.regionCostMemo!, native = memo.get
      memo.get = function (...args): number {
        reads[index]!.push(args[0]); solver.topology.portX[1] = 12
        return native.apply(this, args)
      }
    }
    if (variant === "Math.sqrt" || variant === "Math.max") {
      const name = variant === "Math.sqrt" ? "sqrt" : "max", native = Math[name]
      Math[name] = (...values): number => {
        if (activeHost !== -1) {
          reads[activeHost]!.push(1); hosts[activeHost]!.topology.portX[1] = 12
        }
        return Reflect.apply(native, Math, values) as number
      }
      restore = (): void => { Math[name] = native }
    }
    if (variant === "Map.has" || variant === "Map.get") {
      const name = variant === "Map.has" ? "has" : "get", native = Map.prototype[name]
      ;(Map.prototype as any)[name] = function (...args: unknown[]): unknown {
        for (let index = 0; index < hosts.length; index++) {
          if (this !== (hosts[index] as any).partialRipRoutePlans) continue
          reads[index]!.push(1); hosts[index]!.topology.portX[1] = 12
        }
        return (native as any).apply(this, args)
      }
      restore = (): void => { (Map.prototype as any)[name] = native }
    }
    if (variant === "typed.fill" || variant === "typed.set") {
      const prototype = Object.getPrototypeOf(Uint8Array.prototype)
      const name = variant === "typed.fill" ? "fill" : "set", native = prototype[name]
      prototype[name] = function (...args: unknown[]): unknown {
        if (activeHost !== -1) {
          reads[activeHost]!.push(1); hosts[activeHost]!.topology.portX[1] = 12
        }
        return native.apply(this, args)
      }
      restore = (): void => { prototype[name] = native }
    }
    try {
      for (let prefix = 0; !original.solved && !original.failed; prefix++) {
        if (prefix > 200) throw new Error(`Native fixture did not terminate: ${variant}`)
        activeHost = 0; original.step()
        activeHost = 1; packed.step()
        activeHost = -1
        if (variant === "wrap" && prefix === 0) expect(packed.state.candidateBestCostGeneration).toBe(1)
        expect(observe(packed)).toEqual(observe(original))
        expect(reads[1]).toEqual(reads[0])
      }
      expect(packed.solved).toBe(true)
      expect(packed.state.candidateBestCostByHopId).toBe(bestAlias)
      expect(packed.state.candidateBestCostGenerationByHopId).toBe(bestGenerationAlias)
      expect(packed.topology.portX).toBe(xAlias)
      if (variant !== "assignment") expect(packed.state.portAssignment === assignmentAlias)
        .toBe(original.state.portAssignment === nativeAssignmentAlias)
      expect((original as unknown as Host).wasmNeighborKernel).toBeUndefined()
      const diagnostics = (packed as unknown as Host).wasmNeighborKernel!.diagnostics
      if (["native", "wrap", "assignment", "generation"].includes(variant)) {
        expect(diagnostics.batches).toBeGreaterThan(0)
        expect(diagnostics.disabledReason).toBe("")
      } else {
        expect(diagnostics.batches).toBe(0)
        expect(diagnostics.disabledReason).not.toBe("")
      }
    } finally { restore?.() }
  }
})
