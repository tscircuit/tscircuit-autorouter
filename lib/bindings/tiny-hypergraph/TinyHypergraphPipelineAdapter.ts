import {
  BaseSolver,
  BasePipelineSolver,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { GraphicsObject } from "graphics-debug"
import {
  TinyHyperGraphSolver,
  loadSerializedHyperGraph,
} from "../../../rust/tiny-hypergraph-bindings/ts/index"
import { initializeTinyHypergraphBindings } from "lib/bindings/initializeTinyHypergraphBindings"
import { getSerializedPreloadedTraceStats } from "../../solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"
import type {
  RouteMetadata,
  TinyRegionMetadata,
  TinyPortMetadata,
} from "../../solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import {
  type LoadedTinyHypergraph,
  type TinyHypergraphRoutingInput,
  type TinyHypergraphPolicyCounts,
  type TinyHypergraphSolverView,
} from "../../solvers/PortPointPathingSolver/tinyhypergraph/tinyHypergraphTypes"

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
      regionAvailableZMask:
        t.regionAvailableZMask && new Int32Array(t.regionAvailableZMask),
      regionMetadata:
        t.regionMetadata && ([...t.regionMetadata] as TinyRegionMetadata[]),
      portMetadata:
        t.portMetadata && ([...t.portMetadata] as TinyPortMetadata[]),
      portAngleForRegion1: new Int32Array(t.portAngleForRegion1),
      portAngleForRegion2:
        t.portAngleForRegion2 && new Int32Array(t.portAngleForRegion2),
      portX: new Float64Array(t.portX),
      portY: new Float64Array(t.portY),
      portZ: new Int32Array(t.portZ),
    },
    problem: {
      ...p,
      routeMetadata:
        p.routeMetadata && ([...p.routeMetadata] as RouteMetadata[]),
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

export class TinyHypergraphSearchStage
  extends BaseSolver
  implements TinyHypergraphSolverView
{
  readonly topology: LoadedTinyHypergraph["topology"]
  readonly problem: LoadedTinyHypergraph["problem"]
  readonly solver: TinyHyperGraphSolver
  private snapshot:
    | ReturnType<TinyHyperGraphSolver["getRoutingSnapshot"]>
    | undefined
  private snapshotIterations = -1
  private statsIterations = -1
  private statsRevision = -1
  private statsSnapshot: Record<string, unknown> = {}
  private exposedStatsSnapshot: Record<string, unknown> | undefined
  private statsGetter: (() => Record<string, unknown>) | undefined
  private output?: SerializedHyperGraph
  private graphics?: GraphicsObject

  constructor(
    loaded: LoadedTinyHypergraph,
    options: TinyHypergraphRoutingInput["solveGraphOptions"],
    private readonly selective: boolean,
  ) {
    super()
    this.topology = loaded.topology
    this.problem = loaded.problem
    this.MAX_ITERATIONS = options?.MAX_ITERATIONS ?? 1_000_000
    this.solver = new TinyHyperGraphSolver(
      loaded.topology,
      loaded.problem,
      options,
      {
        variant: selective ? "selective-rerip" : "base",
        preserveInitialAssignments: selective,
      },
    )
    this.statsGetter = (): Record<string, unknown> => {
      this.refreshStatsSnapshot()
      return (this.exposedStatsSnapshot ??= { ...this.statsSnapshot })
    }
    Object.defineProperty(this, "stats", {
      enumerable: true,
      configurable: true,
      get: this.statsGetter,
      set: (value: Record<string, unknown>): void => {
        this.exposedStatsSnapshot = value
      },
    })
  }

  private refreshStatsSnapshot(): void {
    if (this.statsIterations === this.solver.iterations) return
    const revision = this.solver.getStatsRevision()
    if (revision !== this.statsRevision) {
      this.statsSnapshot = this.solver.getStats()
      this.exposedStatsSnapshot = undefined
      this.statsRevision = revision
    }
    this.statsIterations = this.solver.iterations
  }

  captureStatsSnapshot(): Record<string, unknown> {
    if (
      Object.getOwnPropertyDescriptor(this, "stats")?.get !== this.statsGetter
    ) {
      return { ...this.stats }
    }
    this.refreshStatsSnapshot()
    // Never expose a snapshot already captured by the parent: public reads get
    // their own shallow object, retaining exactly the nested-value aliases.
    return this.exposedStatsSnapshot
      ? { ...this.exposedStatsSnapshot }
      : this.statsSnapshot
  }

  override getSolverName(): string {
    return this.selective
      ? "SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
      : "TinyHyperGraphSolver"
  }

  get state(): ReturnType<TinyHyperGraphSolver["getRoutingSnapshot"]> {
    if (!this.snapshot || this.snapshotIterations !== this.solver.iterations) {
      this.snapshot = this.solver.getRoutingSnapshot()
      this.snapshotIterations = this.solver.iterations
    }
    return this.snapshot
  }

  override _step(): void {
    const status = this.solver.step()
    this.iterations = status.iterations
    this.solved = status.solved
    this.failed = status.failed
    this.error =
      status.failed && status.error === "Maximum iterations reached"
        ? `${this.getSolverName()} ran out of iterations`
        : status.error
    if (this.solved || this.failed) {
      void this.state
      void this.stats
      if (this.solved) this.output = this.solver.getOutput()
      this.graphics = this.solver.visualize()
      this.solver.dispose()
    }
  }

  override getOutput(): SerializedHyperGraph {
    if (!this.output)
      throw new Error("WASM tiny-hypergraph output requires a solved graph")
    return this.output
  }

  override visualize(): GraphicsObject {
    return this.graphics ?? this.solver.visualize()
  }
}

class EmptySectionStage extends BaseSolver {
  readonly baselineSolver: TinyHypergraphSolverView
  optimizedSolver?: TinyHypergraphSolverView
  readonly activeRouteIds: number[] = []
  private readonly output: SerializedHyperGraph
  private readonly graphics: GraphicsObject
  private readonly maxRegionCost: number

  constructor(
    loaded: LoadedTinyHypergraph,
    options: TinyHypergraphRoutingInput["sectionSolverOptions"],
  ) {
    super()
    this.MAX_ITERATIONS = options?.MAX_ITERATIONS ?? 50_000
    if (loaded.problem.portSectionMask.some((mask) => mask !== 0)) {
      throw new Error(
        "Autorouter empty-section stage requires a zero section mask",
      )
    }
    const replay = new TinyHyperGraphSolver(
      loaded.topology,
      loaded.problem,
      options,
    )
    try {
      replay.replaySolution(loaded.solution)
      const state = replay.getRoutingSnapshot()
      this.baselineSolver = {
        topology: loaded.topology,
        problem: loaded.problem,
        state,
        iterations: replay.iterations,
        stats: replay.getStats(),
        solved: replay.solved,
        failed: replay.failed,
      }
      this.maxRegionCost = replay.getMaxRegionCost()
      this.output = replay.getOutput()
      this.graphics = replay.visualize()
    } finally {
      replay.dispose()
    }
  }

  override _setup(): void {
    this.optimizedSolver = this.baselineSolver
    this.stats = {
      ...this.stats,
      activeRouteCount: 0,
      initialMaxRegionCost: this.maxRegionCost,
      finalMaxRegionCost: this.maxRegionCost,
      optimized: false,
    }
    this.solved = true
  }

  getSolvedSolver(): TinyHypergraphSolverView {
    if (!this.optimizedSolver)
      throw new Error("Empty section has not completed setup")
    return this.optimizedSolver
  }

  override getOutput(): SerializedHyperGraph {
    return this.output
  }
  override visualize(): GraphicsObject {
    return this.graphics
  }
}

/** The autorouter uses an explicitly empty section after the native search. */
export class TinyHypergraphPipelineAdapter extends BasePipelineSolver<TinyHypergraphRoutingInput> {
  duplicatePortPenaltyCount = 0
  metadataPortPenaltyCount = 0
  crampedPortPenaltyCount = 0
  preloadedPortCount = 0
  preloadedFixedSegmentCount = 0
  crampedPortTraversalPenalty = 150
  declare solveGraph: TinyHypergraphSearchStage | undefined
  declare optimizeSection: EmptySectionStage | undefined
  private initialVisualizationSolver?: TinyHypergraphSearchStage
  readonly backend = "wasm" as const

  constructor(
    input: TinyHypergraphRoutingInput,
    private readonly selectiveRerip: boolean,
    private readonly configure: (
      loaded: LoadedTinyHypergraph,
    ) => TinyHypergraphPolicyCounts,
  ) {
    super(input)
    initializeTinyHypergraphBindings()
    const preloaded = getSerializedPreloadedTraceStats(
      input.serializedHyperGraph,
    )
    this.preloadedPortCount = preloaded.preloadedPortCount
    this.preloadedFixedSegmentCount = preloaded.preloadedAssignmentCount
    this.MAX_ITERATIONS =
      (input.solveGraphOptions?.MAX_ITERATIONS ?? 1_000_000) +
      (input.sectionSolverOptions?.MAX_ITERATIONS ?? 1_000_000) +
      1_000_000
  }

  private loadHyperGraph(graph: SerializedHyperGraph): LoadedTinyHypergraph {
    const loaded = loadGraph(graph)
    const counts = this.configure(loaded)
    this.duplicatePortPenaltyCount = Math.max(
      this.duplicatePortPenaltyCount,
      counts.duplicatePortPenaltyCount,
    )
    this.metadataPortPenaltyCount = Math.max(
      this.metadataPortPenaltyCount,
      counts.metadataPortPenaltyCount,
    )
    this.crampedPortPenaltyCount = Math.max(
      this.crampedPortPenaltyCount,
      counts.crampedPortPenaltyCount,
    )
    this.preloadedPortCount = counts.preloadedPortCount
    this.preloadedFixedSegmentCount = counts.preloadedFixedSegmentCount
    this.crampedPortTraversalPenalty = counts.crampedPortTraversalPenalty
    return loaded
  }

  override pipelineDef: PipelineStep<any>[] = [
    {
      solverName: "solveGraph",
      solverClass: TinyHypergraphSearchStage,
      getConstructorParams: (instance: TinyHypergraphPipelineAdapter) => [
        instance.loadHyperGraph(instance.inputProblem.serializedHyperGraph),
        {
          RIP_THRESHOLD_RAMP_ATTEMPTS: 5,
          ...instance.inputProblem.solveGraphOptions,
        },
        instance.selectiveRerip,
      ],
    },
    {
      solverName: "optimizeSection",
      solverClass: EmptySectionStage,
      getConstructorParams: (instance: TinyHypergraphPipelineAdapter) => {
        const solved =
          instance.getStageOutput<SerializedHyperGraph>("solveGraph")
        if (!solved)
          throw new Error(
            "solveGraph did not produce a solved serialized hypergraph",
          )
        const loaded = instance.loadHyperGraph(solved)
        loaded.problem.portSectionMask.fill(0)
        instance.stats = { ...instance.stats, sectionMaskPortCount: 0 }
        return [
          loaded,
          {
            DISTANCE_TO_COST: 0.05,
            RIP_THRESHOLD_RAMP_ATTEMPTS: 16,
            RIP_CONGESTION_REGION_COST_FACTOR: 0.1,
            MAX_ITERATIONS: 50_000,
            MAX_RIPS_WITHOUT_MAX_REGION_COST_IMPROVEMENT: 6,
            EXTRA_RIPS_AFTER_BEATING_BASELINE_MAX_REGION_COST:
              Number.POSITIVE_INFINITY,
            ...instance.inputProblem.sectionSolverOptions,
          },
        ]
      },
    },
  ]

  getSolvedTinySolver(): TinyHypergraphSolverView {
    if (this.optimizeSection?.solved && !this.optimizeSection.failed)
      return this.optimizeSection.getSolvedSolver()
    if (this.solveGraph?.solved && !this.solveGraph.failed)
      return this.solveGraph
    throw new Error("WASM tiny-hypergraph pipeline has no solved graph")
  }

  override getOutput(): SerializedHyperGraph | null {
    return (
      this.getStageOutput<SerializedHyperGraph>("optimizeSection") ??
      this.getStageOutput<SerializedHyperGraph>("solveGraph") ??
      null
    )
  }

  override tryFinalAcceptance(): void {
    if (this.getStageOutput<SerializedHyperGraph>("solveGraph")) {
      this.stats = {
        ...this.stats,
        acceptedSolveGraphOutputOnSectionPipelineTimeout: true,
      }
      this.activeSubSolver = undefined
      this.solved = true
      this.failed = false
      this.error = null
    }
  }

  override initialVisualize(): GraphicsObject {
    if (!this.initialVisualizationSolver) {
      this.initialVisualizationSolver = new TinyHypergraphSearchStage(
        this.loadHyperGraph(this.inputProblem.serializedHyperGraph),
        {
          RIP_THRESHOLD_RAMP_ATTEMPTS: 5,
          ...this.inputProblem.solveGraphOptions,
        },
        this.selectiveRerip,
      )
    }
    return this.initialVisualizationSolver.visualize()
  }
}

export function captureTinyStageStats(
  stage: TinyHypergraphSolverView | undefined,
): Record<string, unknown> {
  if (stage instanceof TinyHypergraphSearchStage) {
    return stage.captureStatsSnapshot()
  }
  // Replayed or explicitly supplied views have publicly mutable stats objects.
  // Capture their shallow fields now, before the caller can change them.
  return { ...stage?.stats }
}
