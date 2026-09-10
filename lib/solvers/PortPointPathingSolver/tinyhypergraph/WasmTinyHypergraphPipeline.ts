import { BaseSolver } from "@tscircuit/solver-utils"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import {
  TinyHyperGraphSolver,
  loadSerializedHyperGraph,
  initTinyHypergraphWasm,
  type TinyHyperGraphWasmInput,
} from "../../../../rust/tiny-hypergraph-wasm/ts/index"
import {
  registerTinyHypergraphBackend,
  type LoadedTinyHypergraph,
  type TinyHypergraphBackend,
  type TinyHypergraphRoutingInput,
  type TinyHypergraphPolicyCounts,
  type TinyHypergraphSolverView,
} from "./tinyHypergraphBackend"

/** Restore the typed arrays expected by the autorouter's graph policies. */
function loadGraph(graph: SerializedHyperGraph): LoadedTinyHypergraph {
  const { topology: t, problem: p, solution } = loadSerializedHyperGraph(graph)
  return {
    topology: {
      ...t,
      regionIncidentPorts: t.regionIncidentPorts.map((ports) => [...ports]),
      incidentPortRegion: t.incidentPortRegion.map((regions) => [...regions]),
      regionWidth: new Float64Array(t.regionWidth),
      regionHeight: new Float64Array(t.regionHeight),
      regionCenterX: new Float64Array(t.regionCenterX),
      regionCenterY: new Float64Array(t.regionCenterY),
      regionAvailableZMask: t.regionAvailableZMask && new Int32Array(t.regionAvailableZMask),
      regionMetadata: t.regionMetadata && [...t.regionMetadata],
      portMetadata: t.portMetadata && [...t.portMetadata],
      portAngleForRegion1: new Int32Array(t.portAngleForRegion1),
      portAngleForRegion2: t.portAngleForRegion2 && new Int32Array(t.portAngleForRegion2),
      portX: new Float64Array(t.portX),
      portY: new Float64Array(t.portY),
      portZ: new Int32Array(t.portZ),
    },
    problem: {
      ...p,
      routeMetadata: p.routeMetadata && [...p.routeMetadata],
      portSectionMask: new Int8Array(p.portSectionMask),
      routeStartPort: new Int32Array(p.routeStartPort),
      routeEndPort: new Int32Array(p.routeEndPort),
      routeNet: new Int32Array(p.routeNet),
      regionNetId: new Int32Array(p.regionNetId),
      portPenalty: p.portPenalty && new Float64Array(p.portPenalty),
      initialAssignments: p.initialAssignments && [...p.initialAssignments],
    },
    solution,
  }
}

/** One Rust search stage; the main autorouter currently selects an empty section. */
export class WasmTinyHypergraphPipeline extends BaseSolver {
  readonly duplicatePortPenaltyCount: number
  readonly metadataPortPenaltyCount: number
  readonly crampedPortPenaltyCount: number
  readonly preloadedPortCount: number
  readonly preloadedFixedSegmentCount: number
  readonly crampedPortTraversalPenalty: number
  private readonly solver: TinyHyperGraphSolver
  readonly solveGraph: TinyHypergraphSolverView
  readonly backend = "wasm" as const
  private timeSpent = 0
  private output?: SerializedHyperGraph
  private graphics?: GraphicsObject

  constructor(
    input: TinyHypergraphRoutingInput,
    selectiveRerip: boolean,
    configure: (loaded: LoadedTinyHypergraph) => TinyHypergraphPolicyCounts,
  ) {
    super()
    const start = performance.now()
    const loaded = loadGraph(input.serializedHyperGraph)
    const counts = configure(loaded)
    this.duplicatePortPenaltyCount = counts.duplicatePortPenaltyCount
    this.metadataPortPenaltyCount = counts.metadataPortPenaltyCount
    this.crampedPortPenaltyCount = counts.crampedPortPenaltyCount
    this.preloadedPortCount = counts.preloadedPortCount
    this.preloadedFixedSegmentCount = counts.preloadedFixedSegmentCount
    this.crampedPortTraversalPenalty = counts.crampedPortTraversalPenalty
    this.MAX_ITERATIONS = input.solveGraphOptions?.MAX_ITERATIONS ?? 1_000_000
    this.solver = new TinyHyperGraphSolver(loaded.topology, loaded.problem, {
      RIP_THRESHOLD_RAMP_ATTEMPTS: 5,
      ...input.solveGraphOptions,
    }, {
      variant: selectiveRerip ? "selective-rerip" : "base",
      preserveInitialAssignments: selectiveRerip,
    })
    this.solveGraph = {
      topology: loaded.topology,
      problem: loaded.problem,
      state: this.solver.getRoutingSnapshot(),
      iterations: 0,
      stats: {},
      solved: false,
      failed: false,
    }
    this.timeSpent = performance.now() - start
  }

  override _step(): void {
    const start = performance.now()
    try {
      const status = this.solver.stepMany(256)
      this.solved = status.solved
      this.failed = status.failed
      this.error = status.error
      this.solveGraph.iterations = status.iterations
      this.solveGraph.solved = status.solved
      this.solveGraph.failed = status.failed
      this.solveGraph.state = this.solver.getRoutingSnapshot()
      this.stats = { ...this.solver.getStats(), tinyHypergraphBackend: "wasm" }
      this.solveGraph.stats = this.stats
      this.progress = this.solved ? 1 : status.iterations / this.MAX_ITERATIONS
      if (this.solved || this.failed) {
        this.graphics = this.solver.visualize()
        if (this.solved) this.output = this.solver.getOutput()
        this.solver.dispose()
      }
    } catch (error) {
      this.solver.dispose()
      throw error
    } finally {
      this.timeSpent += performance.now() - start
    }
  }

  getSolvedTinySolver(): TinyHypergraphSolverView {
    if (!this.solved || this.failed) {
      throw new Error("WASM tiny-hypergraph pipeline has no solved graph")
    }
    return this.solveGraph
  }

  getStageStats(): Record<string, { timeSpent: number }> {
    return { solveGraph: { timeSpent: this.timeSpent } }
  }

  getCurrentStageName(): string {
    return "solveGraph"
  }

  override getOutput(): SerializedHyperGraph {
    if (!this.output) throw new Error("WASM tiny-hypergraph output requires a solved graph")
    return this.output
  }

  override visualize(): GraphicsObject {
    return this.graphics ?? this.solver.visualize()
  }
}

const backend: TinyHypergraphBackend = {
  createPipeline: (input, selectiveRerip, configure) =>
    new WasmTinyHypergraphPipeline(input, selectiveRerip, configure),
}

export async function enableTinyHypergraphWasm(input: TinyHyperGraphWasmInput): Promise<void> {
  await initTinyHypergraphWasm(input)
  registerTinyHypergraphBackend(backend)
}
