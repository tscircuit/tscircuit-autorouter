import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Repair04Solver } from "@tscircuit/repair04"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import type { CapacityMeshNode } from "lib/types/capacity-mesh-types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types/srj-types"
import { getBenchmarkSolverOptions } from "./benchmark/benchmark-run-task"
import {
  loadScenarioBySampleNumber,
  parseDatasetName,
} from "./benchmark/scenarios"

type Pipeline =
  | AutoroutingPipelineSolver7_MultiGraph
  | AutoroutingPipelineSolver9_PreloadedTraceGraph

type StageSummary = {
  phase: string
  scope: "input" | "node-copper-projection" | "materialized-board"
  errorCount: number
  errorTypes: Record<string, number>
  traceCount: number
}

type NodeObservation = {
  nodeId: string
  node: NodeWithPortPoints
  solver: string
  scaleFactor: number | null
  growthAttempts: number | null
  metadata: unknown
  routes: HighDensityRoute[]
}

type CapacityNodeCapture = Omit<CapacityMeshNode, "_parent"> & {
  parentCapacityMeshNodeId: string | null
}

type TopologySourceGroupCapture = {
  groupId: string
  isComponent: boolean
  nodes: (CapacityNodeCapture & { sourceKey: string })[]
}

type UniformFailureDiagnostic = {
  serialized: string
  status: "active-uniform-solver" | "uniform-instance-unavailable"
  ownerPairKey: string | null
  familyPortCount: number
  errorMessage: string
}

type UniformOwnerBoundsCapture = {
  nodeId: string
  bounds: unknown
}

type TinyFailureDiagnostic = {
  serialized: string
  status: "loaded-tiny-state" | "loaded-tiny-instance-unavailable"
  nativeInstanceCount: number
  errorMessage: string
}

const getDiagnosticOwnValue = (value: unknown, name: string): unknown => {
  if (typeof value !== "object" || value === null) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, name)
  // In particular, never invoke the native solver's lazy problemSetup getter.
  if (!descriptor || !("value" in descriptor)) return undefined
  return descriptor.value
}

const selectDiagnosticOwnFields = (
  value: unknown,
  names: readonly string[],
): Record<string, unknown> => {
  const selected: Record<string, unknown> = {}
  for (const name of names) {
    const field = getDiagnosticOwnValue(value, name)
    selected[name] = field === undefined ? null : field
  }
  return selected
}

const captureTinyFailure = (
  pipeline: Pipeline,
  error: unknown,
  previousWrapper: unknown,
  previousActiveSolver: unknown,
): TinyFailureDiagnostic => {
  const wrapper = pipeline.portPointPathingSolver ?? previousWrapper
  const sectionPipeline = getDiagnosticOwnValue(wrapper, "tinyPipelineSolver")
  const inputProblem = getDiagnosticOwnValue(sectionPipeline, "inputProblem")
  const nativeInstances: Record<string, unknown>[] = []
  const seen = new Set<unknown>()
  const candidates: { source: string; solver: unknown }[] = [
    {
      source: "current-section-pipeline-active-child",
      solver: getDiagnosticOwnValue(sectionPipeline, "activeSubSolver"),
    },
    {
      source: "current-wrapper-active-child",
      solver: getDiagnosticOwnValue(wrapper, "activeSubSolver"),
    },
    { source: "pre-step-observed-active-child", solver: previousActiveSolver },
  ]
  for (const candidate of candidates) {
    let solver = candidate.solver
    let source = candidate.source
    while (typeof solver === "object" && solver !== null && !seen.has(solver)) {
      seen.add(solver)
      const topology = getDiagnosticOwnValue(solver, "topology")
      const problem = getDiagnosticOwnValue(solver, "problem")
      if (topology !== undefined && problem !== undefined) {
        const setup = getDiagnosticOwnValue(solver, "_problemSetup")
        const state = getDiagnosticOwnValue(solver, "state")
        const queue = getDiagnosticOwnValue(state, "candidateQueue")
        const queueItems = getDiagnosticOwnValue(queue, "items")
        nativeInstances.push({
          source,
          ...selectDiagnosticOwnFields(solver, [
            "iterations",
            "MAX_ITERATIONS",
            "solved",
            "failed",
            "error",
            "stats",
            "STATIC_REACHABILITY_PRECHECK",
            "STATIC_REACHABILITY_PRECHECK_MAX_HOPS",
            "routeAttemptCountByRouteId",
            "routeSuccessCountByRouteId",
            "staticallyUnroutableRoutes",
            "selectiveReripStats",
            "failedOwnerPairCounts",
            "selectiveReripCongestionUpdateCount",
            "fixedCopperPortReservations",
          ]),
          topology: selectDiagnosticOwnFields(topology, [
            "portCount",
            "regionCount",
            "regionIncidentPorts",
            "incidentPortRegion",
            "regionWidth",
            "regionHeight",
            "regionCenterX",
            "regionCenterY",
            "regionAvailableZMask",
            "regionMetadata",
            "portX",
            "portY",
            "portZ",
            "portMetadata",
          ]),
          problem: selectDiagnosticOwnFields(problem, [
            "routeCount",
            "routeMetadata",
            "routeNet",
            "routeStartPort",
            "routeEndPort",
            "portSectionMask",
            "regionNetId",
            "portPenalty",
            "initialAssignments",
          ]),
          setupStatus:
            setup === undefined
              ? "unavailable-not-retained-or-not-computed"
              : "already-computed-own-data",
          // A setup exception can discard its local arrays before _problemSetup
          // is assigned. Do not recreate masks or reconstruct an earlier mask.
          originalDenseReservationStatus: "not-separately-retained",
          setup: selectDiagnosticOwnFields(setup, [
            "portEndpointReservationNetId",
            "portEndpointNetIds",
          ]),
          fixedCopperContext: selectDiagnosticOwnFields(
            getDiagnosticOwnValue(solver, "fixedCopperContext"),
            [
              "traceWidth",
              "canonicalNetIdByNetId",
              "netIdByCanonicalNetId",
              "connectionIdByRouteId",
            ],
          ),
          state: selectDiagnosticOwnFields(state, [
            "currentRouteId",
            "currentRouteNetId",
            "goalPortId",
            "unroutedRoutes",
            "ripCount",
            "portAssignment",
            "regionSegments",
            "regionCongestionCost",
          ]),
          queueStatus: Array.isArray(queueItems)
            ? "existing-minheap-items"
            : "queue-storage-unavailable",
          pendingQueueLength: Array.isArray(queueItems)
            ? queueItems.length
            : null,
          pendingQueueRoot:
            Array.isArray(queueItems) && queueItems.length > 0
              ? selectDiagnosticOwnFields(queueItems[0], [
                  "prevRegionId",
                  "portId",
                  "nextRegionId",
                  "f",
                  "g",
                  "h",
                ])
              : null,
          currentDequeuedCandidateStatus: "local-variable-not-retained",
        })
      }
      solver = getDiagnosticOwnValue(solver, "activeSubSolver")
      source = `${source}.activeSubSolver`
    }
  }
  const failure =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack ?? null }
      : { name: "RecordedSolverFailure", message: String(error), stack: null }
  const status =
    nativeInstances.length > 0
      ? "loaded-tiny-state"
      : "loaded-tiny-instance-unavailable"
  const serialized = JSON.stringify(
    {
      diagnostic: "tiny-failure",
      phase: pipeline.getCurrentPhase(),
      status,
      failure,
      unavailableFieldMeaning: "null means absent or null own data, not zero",
      wrapper: selectDiagnosticOwnFields(wrapper, [
        "iterations",
        "MAX_ITERATIONS",
        "failed",
        "error",
        "stats",
        "candidatePortfolioPhase",
        "selectedCandidate",
      ]),
      // The retained input is the graph actually supplied to Tiny, after any
      // duplicate admission. It includes original serialized terminal metadata.
      sectionPipelineInput: selectDiagnosticOwnFields(inputProblem, [
        "serializedHyperGraph",
        "solveGraphOptions",
        "sectionSolverOptions",
      ]),
      preparedFixedCopper: selectDiagnosticOwnFields(
        getDiagnosticOwnValue(pipeline, "fixedPadClearance"),
        ["rectangles", "layerCount", "traceToPadClearance", "viaToPadClearance"],
      ),
      nativeInstances,
    },
    (key: string, value: unknown): unknown => {
      if (key === "_parent") return undefined
      if (
        (key === "portMetadata" || key === "regionMetadata") &&
        Array.isArray(value)
      ) {
        const idField =
          key === "portMetadata" ? "serializedPortId" : "serializedRegionId"
        // The pinned loader defines these reverse-map IDs as non-enumerable.
        // Wrap the retained data without modifying its descriptors or contents.
        return value.map(
          (metadata: unknown): Record<string, unknown> => ({
            data: metadata,
            [idField]: getDiagnosticOwnValue(metadata, idField) ?? null,
          }),
        )
      }
      if (value instanceof Map) return [...value.entries()]
      if (value instanceof Set) return [...value.values()]
      if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
        return Object.values(value)
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        return { nonfiniteNumber: String(value) }
      }
      return value
    },
  )
  return {
    serialized,
    status,
    nativeInstanceCount: nativeInstances.length,
    errorMessage: failure.message,
  }
}

const captureUniformFailure = (
  pipeline: Pipeline,
  error: unknown,
): UniformFailureDiagnostic => {
  const uniform = pipeline.uniformPortDistributionSolver
  const ownerPairKey = uniform?.currentOwnerPairBeingProcessed ?? null
  const family = ownerPairKey
    ? uniform!.mapOfOwnerPairToPortPoints.get(ownerPairKey)
    : undefined
  const sharedEdge = ownerPairKey
    ? uniform!.mapOfOwnerPairToSharedEdge.get(ownerPairKey)
    : undefined
  const ownerNodeIds = new Set<string>()
  for (const port of family ?? []) {
    for (const ownerId of port.ownerNodeIds) ownerNodeIds.add(ownerId)
  }
  for (const ownerId of sharedEdge?.ownerNodeIds ?? []) {
    ownerNodeIds.add(ownerId)
  }
  const familyPortIds = new Set<string>()
  for (const port of family ?? []) {
    if (port.portPointId) familyPortIds.add(port.portPointId)
  }
  // TypeScript-private constructor inputs are ordinary own properties. Select
  // their existing data without calling a solver or requiring a new main API.
  const ownState = selectDiagnosticOwnFields(uniform, [
    "input",
    "canonicalNetIdByPortId",
    "fixedPortIds",
    "physicalPortWitnesses",
  ])
  const failure =
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack ?? null }
      : { name: "NonErrorThrow", message: String(error), stack: null }
  const status = uniform
    ? "active-uniform-solver"
    : "uniform-instance-unavailable"
  const ownerBounds = [...ownerNodeIds].map(
    (nodeId): UniformOwnerBoundsCapture => ({
      nodeId,
      bounds: uniform?.mapOfNodeIdToBounds.get(nodeId) ?? null,
    }),
  )
  const pathingInputSharedEdges =
    pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
      ? (pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints?.filter(
          (edge): boolean =>
            ownerNodeIds.has(edge.nodeIds[0]) &&
            ownerNodeIds.has(edge.nodeIds[1]),
        ) ?? null)
      : null
  const availableSharedEdges =
    pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
      ? (pipeline.availableSegmentPointSolver?.sharedEdgeSegments.filter(
          (edge): boolean =>
            ownerNodeIds.has(edge.nodeIds[0]) &&
            ownerNodeIds.has(edge.nodeIds[1]),
        ) ?? null)
      : null
  const serialized = JSON.stringify(
    {
      diagnostic: "uniform-failure",
      phase: pipeline.getCurrentPhase(),
      status,
      failure,
      ownerPairKey,
      family: family ?? null,
      sharedEdge: sharedEdge ?? null,
      ownerBounds,
      solverState: selectDiagnosticOwnFields(uniform, [
        "iterations",
        "failed",
        "solved",
        "error",
        "ownerPairsToProcess",
        "currentOwnerPairBeingProcessed",
      ]),
      orderedPlacementState: {
        status: "intermediate-state-not-retained-on-solver-instance",
        retainedOrder: "family preserves stored owner-pair input order",
        unavailable: [
          "activeLayer",
          "sortedLayerPorts",
          "selectedAndRepresentableChannels",
          "placementPorts",
          "backwardLatestBounds",
          "forwardPositions",
        ],
        reconstructionPerformed: false,
      },
      // These retained public collections include original proxy assignments
      // and physical tracePoint metadata; they are not pristine stage copies.
      pathingInputSharedEdges,
      availableSharedEdges,
      ...ownState,
    },
    (key: string, value: unknown): unknown => {
      // Keep the exact prepared rectangle/rule inputs, never implementation
      // internals of spatial indexes or circular capacity-node parent graphs.
      if (key === "traceClearanceIndex" || key === "_parent") return undefined
      if (
        (key === "nodeWithPortPoints" || key === "inputNodesWithPortPoints") &&
        Array.isArray(value)
      ) {
        return value.filter(
          (node: unknown): boolean =>
            typeof node === "object" &&
            node !== null &&
            "capacityMeshNodeId" in node &&
            typeof node.capacityMeshNodeId === "string" &&
            ownerNodeIds.has(node.capacityMeshNodeId),
        )
      }
      if (value instanceof Map) {
        const entries: [unknown, unknown][] = [...value.entries()]
        if (
          key === "canonicalNetIdByPortId" ||
          key === "physicalPortWitnesses"
        ) {
          return entries.filter(
            ([portId]): boolean =>
              typeof portId === "string" && familyPortIds.has(portId),
          )
        }
        return entries
      }
      if (value instanceof Set) {
        const values: unknown[] = [...value.values()]
        return key === "fixedPortIds"
          ? values.filter(
              (portId): boolean =>
                typeof portId === "string" && familyPortIds.has(portId),
            )
          : values
      }
      return value
    },
  )
  return {
    serialized,
    status,
    ownerPairKey,
    familyPortCount: family?.length ?? 0,
    errorMessage: failure.message,
  }
}

const captureCapacityNode = (node: CapacityMeshNode): CapacityNodeCapture => {
  const { _parent, ...nodeData } = node
  return {
    ...structuredClone(nodeData),
    parentCapacityMeshNodeId: _parent?.capacityMeshNodeId ?? null,
  }
}

type Repair04Input = ReturnType<Repair04Solver["getConstructorParams"]>[0]
type Repair04Route = ReturnType<Repair04Solver["getOutput"]>[number]

type InvalidRepair04Transition = {
  startIndex: number
  start: Repair04Route["route"][number]
  end: Repair04Route["route"][number]
  exceedsColocationTolerance: boolean
  hasMatchingVia: boolean
  nearestVia: {
    viaIndex: number
    via: Repair04Route["vias"][number]
    deltaX: number
    deltaY: number
    distance: number
  } | null
}

type Repair04InvalidOutputCapture = {
  phase: string
  localInputRouteIndex: number
  localOutputRouteIndex: number
  originalRoute: Repair04Route | null
  repairedRoute: Repair04Route
  originalLockedPointIndices: boolean[] | null
  originalInvalidTransitions: InvalidRepair04Transition[] | null
  repairedInvalidTransitions: InvalidRepair04Transition[]
  unchanged: boolean
  inputOptions: Omit<Repair04Input, "srj" | "routes" | "lockedPointIndices">
  layerCount: number
  stats: Repair04Solver["stats"]
}

// Match the pinned Repair04 merge invariant, not a routing clearance tolerance.
const REPAIR04_REGION_EPSILON = 1e-8

const getInvalidRepair04Transitions = (
  route: Repair04Route,
): InvalidRepair04Transition[] => {
  const invalidTransitions: InvalidRepair04Transition[] = []
  for (let index = 1; index < route.route.length; index += 1) {
    const start = route.route[index - 1]!
    const end = route.route[index]!
    if (start.z === end.z || start.toNextSegmentType === "through_obstacle") {
      continue
    }
    const exceedsColocationTolerance =
      Math.abs(start.x - end.x) > REPAIR04_REGION_EPSILON ||
      Math.abs(start.y - end.y) > REPAIR04_REGION_EPSILON
    const hasMatchingVia = route.vias.some(
      (via): boolean =>
        Math.abs(via.x - start.x) <= REPAIR04_REGION_EPSILON &&
        Math.abs(via.y - start.y) <= REPAIR04_REGION_EPSILON,
    )
    if (!exceedsColocationTolerance && hasMatchingVia) continue
    let nearestVia: InvalidRepair04Transition["nearestVia"] = null
    for (const [viaIndex, via] of route.vias.entries()) {
      const deltaX = via.x - start.x
      const deltaY = via.y - start.y
      const distance = Math.hypot(deltaX, deltaY)
      if (!nearestVia || distance < nearestVia.distance) {
        nearestVia = { viaIndex, via, deltaX, deltaY, distance }
      }
    }
    invalidTransitions.push({
      startIndex: index - 1,
      start,
      end,
      exceedsColocationTolerance,
      hasMatchingVia,
      nearestVia,
    })
  }
  return invalidTransitions
}

const NODE_PHASES = new Set([
  "highDensityRouteSolver",
  "highDensityForceImproveSolver",
  "highDensityRepairSolver",
])

const BOARD_PHASES = new Set([
  "highDensityStitchSolver",
  "traceSimplificationSolver",
  "mutatedPreloadedTraceSimplificationSolver",
  "traceWidthSolver",
  "globalDrcForceImproveSolver",
  "exactGeometryDrcForceImproveSolver",
  "pipeline9JointDrcRepairSolver",
])

const getStageRoutes = (
  pipeline: Pipeline,
  phase: string,
): HighDensityRoute[] => {
  switch (phase) {
    case "highDensityRouteSolver":
      return pipeline.highDensityRouteSolver!.routes
    case "highDensityForceImproveSolver":
      return pipeline.highDensityForceImproveSolver!.getOutput()
    case "highDensityRepairSolver":
      return pipeline.highDensityRepairSolver!.getOutput()
    case "highDensityStitchSolver":
      return pipeline.highDensityStitchSolver!.mergedHdRoutes
    case "traceSimplificationSolver":
    case "mutatedPreloadedTraceSimplificationSolver":
      return pipeline.traceSimplificationSolver!.simplifiedHdRoutes
    case "traceWidthSolver":
      return pipeline.traceWidthSolver!.getHdRoutesWithWidths()
    case "globalDrcForceImproveSolver":
      return pipeline.globalDrcForceImproveSolver!.getOutput()
    case "exactGeometryDrcForceImproveSolver":
      if (pipeline instanceof AutoroutingPipelineSolver7_MultiGraph) {
        return pipeline.exactGeometryDrcForceImproveSolver!.getOutput()
      }
      throw new Error("Exact-geometry stage requires Pipeline7")
    case "pipeline9JointDrcRepairSolver":
      if (pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph) {
        return pipeline.pipeline9JointDrcRepairSolver!.getOutput()
      }
      throw new Error("Joint stage requires Pipeline9")
    default:
      throw new Error(`Unsupported diagnostic route stage: ${phase}`)
  }
}

const convertStageRoutes = (
  pipeline: Pipeline,
  phase: string,
  routes: HighDensityRoute[],
): SimplifiedPcbTrace[] => {
  const pointPairSolver = pipeline.netToPointPairsSolver
  if (!pointPairSolver) {
    throw new Error(`Missing point-pair metadata for ${phase}`)
  }
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
    connections: pointPairSolver.newConnections,
    originalConnections: pipeline.originalSrj.connections,
    hdRoutes: routes,
    layerCount: pipeline.srj.layerCount,
    obstacles: pipeline.srj.obstacles,
    defaultViaHoleDiameter: pipeline.viaHoleDiameter,
    connMap: pipeline.connMap,
  })
  const uniqueTraces = assignUniquePcbTraceIdsToNewTraces(
    traces,
    pipeline.originalSrj.traces ?? [],
  )
  if (
    BOARD_PHASES.has(phase) &&
    pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
  ) {
    return [...pipeline.getMutatedPreloadedTraces(), ...uniqueTraces]
  }
  return uniqueTraces
}

const writeStage = async (
  pipeline: Pipeline,
  outputDir: string,
  phase: string,
  routedTraces: SimplifiedPcbTrace[],
  routes: HighDensityRoute[],
  scope: StageSummary["scope"],
): Promise<StageSummary> => {
  const result = evaluateRelaxedDrc({
    inputSrj: pipeline.originalSrj,
    srjWithPointPairs: pipeline.srjWithPointPairs ?? pipeline.originalSrj,
    routedTraces,
    drcOptions:
      scope === "node-copper-projection"
        ? { includeTraceContinuity: false }
        : undefined,
  })
  const evaluatedTraces = combinePreloadedAndRoutedTraces(
    pipeline.originalSrj.traces ?? [],
    routedTraces,
  )
  const errorTypes: Record<string, number> = {}
  for (const error of result.errors) {
    errorTypes[error.type] = (errorTypes[error.type] ?? 0) + 1
  }
  const summary: StageSummary = {
    phase,
    scope,
    errorCount: result.errors.length,
    errorTypes,
    traceCount: evaluatedTraces.length,
  }
  const routedTraceObjects = new Set(routedTraces)
  const traceOwnership = evaluatedTraces.map((trace) => ({
    pcbTraceId: trace.pcb_trace_id,
    connectionName: trace.connection_name,
    ownership: trace.__replaces_pcb_trace_id
      ? "mutated-preloaded"
      : routedTraceObjects.has(trace)
        ? "new"
        : "preloaded",
    replacesPcbTraceId: trace.__replaces_pcb_trace_id,
  }))
  await writeFile(
    path.join(outputDir, `${phase}.json`),
    JSON.stringify({
      ...summary,
      // Before stitching these are node fragments, not a final-board score.
      // Keep original and routed geometry to diagnose seam/ownership effects.
      // Changed preload fragments absent from newConnections remain in hdRoutes
      // but are not materialized in this pre-stitch copper projection.
      errors: result.errorsWithCenters,
      traceOwnership,
      routedTraces,
      hdRoutes: routes,
      circuitJson: result.circuitJson,
      // Read completed public counters; do not run another repair candidate.
      globalDrcStats:
        phase === "globalDrcForceImproveSolver"
          ? structuredClone(pipeline.globalDrcForceImproveSolver!.stats)
          : undefined,
    }),
  )
  console.log(JSON.stringify(summary))
  return summary
}

const diagnosePipelineDrc = async (): Promise<void> => {
  const [datasetArg, sampleArg, pipelineArg, outputDir, fixturePath] =
    process.argv.slice(2)
  const dataset = parseDatasetName(datasetArg)
  const sample = Number(sampleArg)
  if (
    (!dataset && !(datasetArg === "fixture" && fixturePath)) ||
    (dataset && fixturePath) ||
    !Number.isInteger(sample) ||
    sample < 1 ||
    (pipelineArg !== "7" && pipelineArg !== "9") ||
    !outputDir
  ) {
    throw new Error(
      "Usage: bun scripts/diagnosePipelineDrc.ts DATASET|fixture SAMPLE 7|9 OUTPUT_DIR [BUG_REPORT_JSON]",
    )
  }
  await mkdir(outputDir, { recursive: true })
  let scenario: SimpleRouteJson
  if (dataset) {
    scenario = (await loadScenarioBySampleNumber(dataset, sample)).scenario
  } else if (fixturePath) {
    const report: { simple_route_json?: SimpleRouteJson } = JSON.parse(
      await readFile(fixturePath, "utf8"),
    )
    if (!report.simple_route_json) {
      throw new Error(`Missing simple_route_json in fixture "${fixturePath}"`)
    }
    scenario = report.simple_route_json
  } else {
    throw new Error("Diagnostic input source was not resolved")
  }
  const scenarioOptions = getBenchmarkSolverOptions(scenario)
  const pipeline: Pipeline =
    pipelineArg === "9"
      ? new AutoroutingPipelineSolver9_PreloadedTraceGraph(
          scenario,
          scenarioOptions,
        )
      : new AutoroutingPipelineSolver7_MultiGraph(scenario, scenarioOptions)
  await writeFile(
    path.join(outputDir, "scenario.json"),
    JSON.stringify(scenario),
  )
  const summaries: StageSummary[] = [
    await writeStage(pipeline, outputDir, "input", [], [], "input"),
  ]
  const nodes: NodeObservation[] = []
  const growthByNode = new Map<string, GrowShrinkHighDensityIntraNodeSolver>()
  let mergedCapacityNodes: CapacityNodeCapture[] | null = null
  const repair04InvalidOutputs: Repair04InvalidOutputCapture[] = []
  let uniformFailureDiagnostic: UniformFailureDiagnostic | undefined
  let tinyFailureDiagnostic: TinyFailureDiagnostic | undefined
  let previousPathingWrapper: unknown
  let previousPathingActiveSolver: unknown
  const originalRepair04GetOutput = Repair04Solver.prototype.getOutput
  // This controller runs in its own process, never a shared Bun test process.
  Repair04Solver.prototype.getOutput = function (
    this: Repair04Solver,
  ): ReturnType<Repair04Solver["getOutput"]> {
    const output = originalRepair04GetOutput.call(this)
    const invalidRoutes: {
      routeIndex: number
      transitions: InvalidRepair04Transition[]
    }[] = []
    for (const [routeIndex, route] of output.entries()) {
      const transitions = getInvalidRepair04Transitions(route)
      if (transitions.length > 0) {
        invalidRoutes.push({ routeIndex, transitions })
      }
    }
    if (invalidRoutes.length === 0) return output
    const [input] = this.getConstructorParams()
    const { srj, routes, lockedPointIndices, ...inputOptions } = input
    for (const { routeIndex, transitions } of invalidRoutes) {
      const originalRoute = routes[routeIndex]
      const repairedRoute = output[routeIndex]!
      const capture: Repair04InvalidOutputCapture = {
        phase: pipeline.getCurrentPhase(),
        localInputRouteIndex: routeIndex,
        localOutputRouteIndex: routeIndex,
        originalRoute: originalRoute ?? null,
        repairedRoute,
        // These indices address the constructor input, not the repaired points.
        originalLockedPointIndices: lockedPointIndices[routeIndex] ?? null,
        originalInvalidTransitions: originalRoute
          ? getInvalidRepair04Transitions(originalRoute)
          : null,
        repairedInvalidTransitions: transitions,
        unchanged: isDeepStrictEqual(originalRoute, repairedRoute),
        inputOptions,
        layerCount: srj.layerCount,
        stats: { ...this.stats },
      }
      repair04InvalidOutputs.push(capture)
      // Emit before merge resumes so a thrown invariant cannot lose the capture.
      console.error(
        JSON.stringify({
          diagnostic: "repair04-invalid-output",
          dataset: datasetArg,
          sample,
          pipeline: pipelineArg,
          ...capture,
        }),
      )
    }
    return output
  }
  try {
    while (!pipeline.solved && !pipeline.failed) {
      const phase = pipeline.getCurrentPhase()
      if (phase === "portPointPathingSolver") {
        // Retain references only. Copy no topology or search state while routing.
        previousPathingWrapper = pipeline.portPointPathingSolver
        previousPathingActiveSolver =
          pipeline.portPointPathingSolver?.activeSubSolver
      }
      const hd =
        pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
          ? pipeline.highDensityRouteSolver
          : undefined
      const node = hd?.activeNode
      const regular = hd?.activeRegularSolver
      const nodeSolver =
        regular ?? hd?.activeB01Solver ?? hd?.activeFallbackSolver
      const grow = regular?.activeSubSolver
      if (node && grow instanceof GrowShrinkHighDensityIntraNodeSolver) {
        growthByNode.set(node.capacityMeshNodeId, grow)
      }
      const routeStart = hd?.routes.length ?? 0
      const simplification =
        phase === "traceSimplificationSolver"
          ? pipeline.traceSimplificationSolver
          : undefined
      const simplificationPhase = simplification
        ? `${simplification.simplificationPipelineLoops}-${simplification.currentPhase}`
        : null
      try {
        pipeline.step()
      } catch (error) {
        if (
          phase === "portPointPathingSolver" ||
          pipeline.getCurrentPhase() === "portPointPathingSolver"
        ) {
          try {
            tinyFailureDiagnostic = captureTinyFailure(
              pipeline,
              error,
              previousPathingWrapper,
              previousPathingActiveSolver,
            )
            console.error(
              JSON.stringify({
                diagnostic: "tiny-failure",
                dataset: datasetArg,
                sample,
                pipeline: pipelineArg,
                status: tinyFailureDiagnostic.status,
                nativeInstanceCount: tinyFailureDiagnostic.nativeInstanceCount,
                error: tinyFailureDiagnostic.errorMessage,
              }),
            )
          } catch (captureError) {
            console.error("tiny failure state capture failed", captureError)
          }
        }
        if (
          phase === "uniformPortDistributionSolver" ||
          pipeline.getCurrentPhase() === "uniformPortDistributionSolver"
        ) {
          try {
            uniformFailureDiagnostic = captureUniformFailure(pipeline, error)
            console.error(
              JSON.stringify({
                diagnostic: "uniform-failure",
                dataset: datasetArg,
                sample,
                pipeline: pipelineArg,
                status: uniformFailureDiagnostic.status,
                ownerPairKey: uniformFailureDiagnostic.ownerPairKey,
                familyPortCount: uniformFailureDiagnostic.familyPortCount,
                error: uniformFailureDiagnostic.errorMessage,
              }),
            )
          } catch (captureError) {
            console.error("uniform failure state capture failed", captureError)
          }
        }
        throw error
      }
      if (
        simplification &&
        simplificationPhase !==
          `${simplification.simplificationPipelineLoops}-${simplification.currentPhase}`
      ) {
        await writeFile(
          path.join(outputDir, `simplification-${simplificationPhase}.json`),
          JSON.stringify({
            phase: simplificationPhase,
            hdRoutes: simplification.simplifiedHdRoutes,
          }),
        )
      }
      if (hd && node && nodeSolver && hd.activeNode !== node) {
        const completedGrowth = regular
          ? growthByNode.get(node.capacityMeshNodeId)
          : undefined
        nodes.push({
          nodeId: node.capacityMeshNodeId,
          node,
          solver: nodeSolver.getSolverName(),
          scaleFactor: completedGrowth ? completedGrowth.scaleFactor : null,
          growthAttempts: completedGrowth
            ? completedGrowth.growthAttempts
            : null,
          metadata: regular
            ? [...regular.nodeSolveMetadataById.values()]
            : null,
          routes: hd.routes.slice(routeStart),
        })
      }
      if (pipeline.getCurrentPhase() !== phase) {
        if (
          phase === "topologyMergingSolver" &&
          pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
        ) {
          mergedCapacityNodes = pipeline.capacityNodes!.map(captureCapacityNode)
        }
        if (NODE_PHASES.has(phase) || BOARD_PHASES.has(phase)) {
          const routes = getStageRoutes(pipeline, phase)
          summaries.push(
            await writeStage(
              pipeline,
              outputDir,
              phase,
              convertStageRoutes(pipeline, phase, routes),
              routes,
              NODE_PHASES.has(phase)
                ? "node-copper-projection"
                : "materialized-board",
            ),
          )
        }
        await writeFile(
          path.join(outputDir, "progress.json"),
          JSON.stringify({
            phase: pipeline.getCurrentPhase(),
            solved: pipeline.solved,
            failed: pipeline.failed,
            error: pipeline.error,
            summaries,
            repair04InvalidOutputs,
          }),
        )
        if (phase === "highDensityRouteSolver") {
          await writeFile(
            path.join(outputDir, "nodes.json"),
            JSON.stringify(nodes),
          )
          if (
            pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
          ) {
            const sourceGroups: TopologySourceGroupCapture[] =
              pipeline.topologyMergingSolver!.inputProblem.nodeGroups.map(
                (group): TopologySourceGroupCapture => ({
                  groupId: group.groupId,
                  isComponent: group.isComponent,
                  nodes: group.nodes.map(
                    (node): CapacityNodeCapture & { sourceKey: string } => {
                      // This is the merger's input key, not inferred provenance.
                      const sourceKey = `${group.groupId}:${node.capacityMeshNodeId}`
                      return {
                        ...captureCapacityNode(node),
                        sourceKey,
                      }
                    },
                  ),
                }),
              )
            await writeFile(
              path.join(outputDir, "capacity-port-provenance.json"),
              JSON.stringify({
                phase,
                sourceGroups,
                mergedNodeSourceMapping: "not-publicly-exposed",
                mergedCapacityNodes,
                capacityNodes: pipeline.capacityNodes!.map(captureCapacityNode),
                capacityEdges: pipeline.capacityEdges,
                availableSharedEdges:
                  pipeline.availableSegmentPointSolver!.sharedEdgeSegments,
                pathingInputSharedEdges:
                  pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints,
                uniformNodes:
                  pipeline.uniformPortDistributionSolver!.redistributedNodes,
                highDensityInputNodes: pipeline.highDensityNodePortPoints,
              }),
            )
          }
        }
      }
    }
    if (
      pipeline.failed &&
      pipeline.getCurrentPhase() === "portPointPathingSolver"
    ) {
      try {
        tinyFailureDiagnostic = captureTinyFailure(
          pipeline,
          pipeline.error,
          previousPathingWrapper,
          previousPathingActiveSolver,
        )
        console.error(
          JSON.stringify({
            diagnostic: "tiny-failure",
            dataset: datasetArg,
            sample,
            pipeline: pipelineArg,
            status: tinyFailureDiagnostic.status,
            nativeInstanceCount: tinyFailureDiagnostic.nativeInstanceCount,
            error: tinyFailureDiagnostic.errorMessage,
          }),
        )
      } catch (captureError) {
        console.error("tiny failure state capture failed", captureError)
      }
    }
  } finally {
    Repair04Solver.prototype.getOutput = originalRepair04GetOutput
    if (tinyFailureDiagnostic) {
      try {
        await writeFile(
          path.join(outputDir, "tiny-failure.json"),
          tinyFailureDiagnostic.serialized,
        )
      } catch (artifactError) {
        // Preserve the original throw or recorded failed-state outcome.
        console.error("tiny capture artifact write failed", artifactError)
      }
    }
    if (uniformFailureDiagnostic) {
      try {
        await writeFile(
          path.join(outputDir, "uniform-failure.json"),
          uniformFailureDiagnostic.serialized,
        )
      } catch (artifactError) {
        // Diagnostic I/O must not replace the original Uniform exception.
        console.error("uniform capture artifact write failed", artifactError)
      }
    }
    if (repair04InvalidOutputs.length > 0) {
      // BaseSolver rethrows invariant errors, bypassing the normal final files.
      try {
        await writeFile(
          path.join(outputDir, "repair04-invalid-output.json"),
          JSON.stringify(repair04InvalidOutputs),
        )
      } catch (artifactError) {
        // Never replace the solver exception with a diagnostic I/O failure.
        console.error("repair04 capture artifact write failed", artifactError)
      }
    }
  }
  if (!pipeline.solved) {
    await writeFile(
      path.join(outputDir, "progress.json"),
      JSON.stringify({
        phase: pipeline.getCurrentPhase(),
        solved: pipeline.solved,
        failed: pipeline.failed,
        error: pipeline.error,
        summaries,
        repair04InvalidOutputs,
      }),
    )
    await writeFile(path.join(outputDir, "nodes.json"), JSON.stringify(nodes))
    throw new Error(`Diagnostic solve failed: ${pipeline.error}`)
  }
  summaries.push(
    await writeStage(
      pipeline,
      outputDir,
      "final",
      pipeline.getOutputSimplifiedPcbTraces(),
      [],
      "materialized-board",
    ),
  )
  await writeFile(
    path.join(outputDir, "summary.json"),
    JSON.stringify({
      dataset: datasetArg,
      sample,
      fixturePath,
      pipeline: pipelineArg,
      summaries,
      repair04InvalidOutputs,
    }),
  )
}

await diagnosePipelineDrc()
