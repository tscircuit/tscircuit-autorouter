import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import { Repair04Solver } from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/assignUniquePcbTraceIdsToNewTraces"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
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
import { createTinyStaticReachabilityCertificate } from "./diagnostics/createTinyStaticReachabilityCertificate"

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

type InvalidRawHdTransition = {
  previousPointIndex: number
  pointIndex: number
  previousPoint: HighDensityRoute["route"][number]
  point: HighDensityRoute["route"][number]
  previousPointViaIndexes: number[]
  pointViaIndexes: number[]
  reason: "missing-explicit-endpoint-via" | "ambiguous-endpoint-vias"
}

type InvalidRawHdRouteCapture = {
  inputRouteIndex: number
  route: HighDensityRoute
  transitions: InvalidRawHdTransition[]
  producers: (Omit<NodeObservation, "routes"> & {
    nodeRouteIndex: number
  })[]
  producerStatus: "observed-route-identity" | "unavailable"
}

type RawHdTransitionDiagnostic = {
  status: "captured-raw-hd-routes" | "raw-hd-routes-unavailable"
  positionEpsilon: number
  inputRouteCount: number | null
  invalidRoutes: InvalidRawHdRouteCapture[]
  regionalInnerStageProvenance: "unavailable-not-observed"
}

type RegionalBoundaryObservation = {
  ordinal: number
  boundaryCount: number
  solver: object
  highDensitySolver: unknown
  grow: GrowShrinkHighDensityIntraNodeSolver | null
}

type RegionalStepObservation = {
  entry: RegionalBoundaryObservation
  phaseBefore: unknown
  outerHd: unknown
  outerRouteStart: number
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

const captureInvalidRawHdTransitions = (
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  nodes: readonly NodeObservation[],
): RawHdTransitionDiagnostic => {
  const hd = getDiagnosticOwnValue(pipeline, "highDensityRouteSolver")
  const rawRoutes = getDiagnosticOwnValue(hd, "routes")
  const positionEpsilon = 1e-6
  const diagnostic: RawHdTransitionDiagnostic = {
    status: Array.isArray(rawRoutes)
      ? "captured-raw-hd-routes"
      : "raw-hd-routes-unavailable",
    positionEpsilon,
    inputRouteCount: Array.isArray(rawRoutes) ? rawRoutes.length : null,
    invalidRoutes: [],
    regionalInnerStageProvenance: "unavailable-not-observed",
  }
  if (!Array.isArray(rawRoutes)) return diagnostic
  const routes: readonly HighDensityRoute[] = rawRoutes
  for (const [inputRouteIndex, route] of routes.entries()) {
    const transitions: InvalidRawHdTransition[] = []
    for (let pointIndex = 1; pointIndex < route.route.length; pointIndex++) {
      const previousPoint = route.route[pointIndex - 1]!
      const point = route.route[pointIndex]!
      if (
        previousPoint.z === point.z ||
        previousPoint.toNextSegmentType === "through_obstacle"
      ) {
        continue
      }
      // Match materializePipeline9HdRouteVias without invoking it. Its inserted
      // points precede the original point, so the next pair is still this pair.
      const transitionIsColocated =
        Math.abs(previousPoint.x - point.x) <= positionEpsilon &&
        Math.abs(previousPoint.y - point.y) <= positionEpsilon
      if (transitionIsColocated) continue
      const previousPointViaIndexes: number[] = []
      const pointViaIndexes: number[] = []
      for (const [viaIndex, via] of route.vias.entries()) {
        if (
          Math.abs(via.x - previousPoint.x) <= positionEpsilon &&
          Math.abs(via.y - previousPoint.y) <= positionEpsilon
        ) {
          previousPointViaIndexes.push(viaIndex)
        }
        if (
          Math.abs(via.x - point.x) <= positionEpsilon &&
          Math.abs(via.y - point.y) <= positionEpsilon
        ) {
          pointViaIndexes.push(viaIndex)
        }
      }
      const hasViaAtPreviousPoint = previousPointViaIndexes.length > 0
      const hasViaAtPoint = pointViaIndexes.length > 0
      if (hasViaAtPreviousPoint !== hasViaAtPoint) continue
      transitions.push({
        previousPointIndex: pointIndex - 1,
        pointIndex,
        previousPoint,
        point,
        previousPointViaIndexes,
        pointViaIndexes,
        reason: hasViaAtPreviousPoint
          ? "ambiguous-endpoint-vias"
          : "missing-explicit-endpoint-via",
      })
    }
    if (transitions.length === 0) continue
    const producers: InvalidRawHdRouteCapture["producers"] = []
    for (const observation of nodes) {
      const nodeRouteIndex = observation.routes.indexOf(route)
      if (nodeRouteIndex < 0) continue
      producers.push({
        nodeId: observation.nodeId,
        node: observation.node,
        solver: observation.solver,
        scaleFactor: observation.scaleFactor,
        growthAttempts: observation.growthAttempts,
        metadata: observation.metadata,
        nodeRouteIndex,
      })
    }
    diagnostic.invalidRoutes.push({
      inputRouteIndex,
      route,
      transitions,
      producers,
      producerStatus:
        producers.length > 0 ? "observed-route-identity" : "unavailable",
    })
  }
  return diagnostic
}

const captureRegionalBoundaryData = (
  observation: RegionalStepObservation,
): Record<string, unknown> => {
  const { entry } = observation
  const params = getDiagnosticOwnValue(entry.solver, "params")
  const force = getDiagnosticOwnValue(entry.solver, "forceImproveSolver")
  const repair = getDiagnosticOwnValue(entry.solver, "repairSolver")
  const forceOverrides = getDiagnosticOwnValue(force, "improvedRoutesByIndex")
  const repairOverrides = getDiagnosticOwnValue(repair, "repairedRoutesByIndex")
  const metadata = getDiagnosticOwnValue(
    entry.highDensitySolver,
    "nodeSolveMetadataById",
  )
  const winner = getDiagnosticOwnValue(entry.grow, "winningSolver")
  const preScaleRoutes = getDiagnosticOwnValue(winner, "solvedRoutes")
  const postScaleRoutes = getDiagnosticOwnValue(entry.grow, "solvedRoutes")
  const outerRoutes = getDiagnosticOwnValue(observation.outerHd, "routes")
  const growParams = getDiagnosticOwnValue(entry.grow, "constructorParams")
  const growSolutionObserved =
    getDiagnosticOwnValue(entry.grow, "solved") === true &&
    Array.isArray(preScaleRoutes) &&
    Array.isArray(postScaleRoutes)
  return {
    input: selectDiagnosticOwnFields(params, [
      "nodeWithPortPoints",
      "viaDiameter",
      "traceWidth",
      "obstacleMargin",
      "layerCount",
    ]),
    regionalState: selectDiagnosticOwnFields(entry.solver, [
      "phase",
      "solved",
      "failed",
      "error",
    ]),
    rawRegionalHd: selectDiagnosticOwnFields(entry.highDensitySolver, [
      "solved",
      "failed",
      "routes",
    ]),
    nodeSolveMetadataEntries:
      metadata instanceof Map
        ? Array.from(Map.prototype.entries.call(metadata))
        : null,
    grow: {
      status: growSolutionObserved
        ? "observed-successful-grow-arrays"
        : "successful-grow-arrays-unavailable",
      ...selectDiagnosticOwnFields(entry.grow, [
        "scaleFactor",
        "growthAttempts",
        "nodeWithPortPoints",
      ]),
      dimensions: selectDiagnosticOwnFields(growParams, [
        "traceWidth",
        "viaDiameter",
        "obstacleMargin",
      ]),
      winningPortfolioNode:
        getDiagnosticOwnValue(winner, "nodeWithPortPoints") ?? null,
      preInverseScaleRoutes: growSolutionObserved ? preScaleRoutes : null,
      postInverseScaleRoutes: growSolutionObserved ? postScaleRoutes : null,
    },
    force: {
      ...selectDiagnosticOwnFields(force, [
        "originalHdRoutes",
        "originalNodeWithPortPoints",
        "solved",
        "failed",
      ]),
      improvedRoutesByIndexEntries:
        forceOverrides instanceof Map
          ? Array.from(Map.prototype.entries.call(forceOverrides))
          : null,
    },
    repair: {
      ...selectDiagnosticOwnFields(repair, [
        "originalHdRoutes",
        "originalNodeWithPortPoints",
        "solved",
        "failed",
      ]),
      repairedRoutesByIndexEntries:
        repairOverrides instanceof Map
          ? Array.from(Map.prototype.entries.call(repairOverrides))
          : null,
    },
    outerPublishedRoutesThisStep: Array.isArray(outerRoutes)
      ? outerRoutes.slice(observation.outerRouteStart)
      : null,
  }
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
        const initialAssignmentsDescriptor =
          typeof problem === "object" && problem !== null
            ? Object.getOwnPropertyDescriptor(problem, "initialAssignments")
            : null
        const nativeConstructor = getDiagnosticOwnValue(
          Object.getPrototypeOf(solver),
          "constructor",
        )
        const nativeSolverClass =
          typeof nativeConstructor === "function"
            ? Object.getOwnPropertyDescriptor(nativeConstructor, "name")?.value
            : undefined
        const state = getDiagnosticOwnValue(solver, "state")
        const queue = getDiagnosticOwnValue(state, "candidateQueue")
        const queueItems = getDiagnosticOwnValue(queue, "items")
        nativeInstances.push({
          source,
          nativeSolverClass:
            typeof nativeSolverClass === "string" ? nativeSolverClass : null,
          // Native loader omits this optional property when no seeds exist.
          // Keep observed absence distinct from arbitrary null capture data.
          initialAssignmentsStatus:
            initialAssignmentsDescriptor === undefined
              ? "absent-optional-native-field"
              : initialAssignmentsDescriptor &&
                  "value" in initialAssignmentsDescriptor &&
                  Array.isArray(initialAssignmentsDescriptor.value)
                ? "captured-array"
                : "unsupported-native-value",
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
        [
          "rectangles",
          "layerCount",
          "traceToPadClearance",
          "viaToPadClearance",
        ],
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

type JointEvaluatorName = "drcEvaluator" | "cachedReferenceDrcEvaluator"

type JointEvaluatorInvalidInputCapture = {
  phase: string
  evaluatorName: JointEvaluatorName
  callSequence: number
  evaluatorCallSequence: number
  callStack: string | null
  inputField: "routes" | "hdRoutes"
  inputRouteCount: number
  inputRouteIndex: number
  route: Repair04Route
  invalidTransitions: InvalidRepair04Transition[]
}

type JointEvaluatorDiagnostic = {
  hooks: {
    evaluatorName: JointEvaluatorName
    status: "installed" | "unavailable-writable-own-function" | "install-error"
  }[]
  callCount: number
  observations: JointEvaluatorInvalidInputCapture[]
  failure: { phase: string; message: string; stack: string | null } | null
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

const installJointEvaluatorInputCapture = (
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
  diagnostic: JointEvaluatorDiagnostic,
): (() => void) => {
  const joint = pipeline.pipeline9JointDrcRepairSolver!
  const originals: {
    evaluatorName: JointEvaluatorName
    descriptor: PropertyDescriptor
  }[] = []
  for (const evaluatorName of [
    "drcEvaluator",
    "cachedReferenceDrcEvaluator",
  ] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(joint, evaluatorName)
    if (
      !descriptor ||
      !("value" in descriptor) ||
      descriptor.writable !== true ||
      typeof descriptor.value !== "function"
    ) {
      diagnostic.hooks.push({
        evaluatorName,
        status: "unavailable-writable-own-function",
      })
      continue
    }
    const original = descriptor.value as DrcEvaluator
    let evaluatorCallSequence = 0
    const observedEvaluator = function (
      this: unknown,
      ...args: Parameters<DrcEvaluator>
    ): ReturnType<DrcEvaluator> {
      diagnostic.callCount++
      evaluatorCallSequence++
      try {
        // Inspect data descriptors only: a diagnostic must not invoke a lazy
        // input getter before the original evaluator reads its arguments.
        const input = args[0]
        const routesDescriptor = Object.getOwnPropertyDescriptor(
          input,
          "routes",
        )
        let inputField: "routes" | "hdRoutes" | undefined
        let routes: unknown
        if (routesDescriptor && "value" in routesDescriptor) {
          if (
            routesDescriptor.value !== undefined &&
            routesDescriptor.value !== null
          ) {
            inputField = "routes"
            routes = routesDescriptor.value
          }
        }
        if (
          inputField === undefined &&
          (!routesDescriptor || "value" in routesDescriptor)
        ) {
          const hdRoutesDescriptor = Object.getOwnPropertyDescriptor(
            input,
            "hdRoutes",
          )
          if (hdRoutesDescriptor && "value" in hdRoutesDescriptor) {
            inputField = "hdRoutes"
            routes = hdRoutesDescriptor.value
          }
        }
        if (inputField !== undefined && Array.isArray(routes)) {
          const observedRoutes = routes as Repair04Route[]
          for (const [inputRouteIndex, route] of observedRoutes.entries()) {
            const invalidTransitions: InvalidRepair04Transition[] = []
            for (const transition of getInvalidRepair04Transitions(route)) {
              if (transition.exceedsColocationTolerance) {
                invalidTransitions.push(transition)
              }
            }
            if (invalidTransitions.length === 0) continue
            diagnostic.observations.push({
              phase: pipeline.getCurrentPhase(),
              evaluatorName,
              callSequence: diagnostic.callCount,
              evaluatorCallSequence,
              callStack:
                new Error("Joint evaluator input observation").stack ?? null,
              inputField,
              inputRouteCount: observedRoutes.length,
              inputRouteIndex,
              route: structuredClone(route),
              invalidTransitions: structuredClone(invalidTransitions),
            })
          }
        }
      } catch (captureError) {
        // Observation failures must not change the evaluator call or its error.
        console.error("Joint evaluator input capture failed", captureError)
      }
      return original.apply(this, args)
    }
    try {
      Object.defineProperty(joint, evaluatorName, {
        ...descriptor,
        value: observedEvaluator,
      })
      originals.push({ evaluatorName, descriptor })
      diagnostic.hooks.push({ evaluatorName, status: "installed" })
    } catch (captureError) {
      diagnostic.hooks.push({ evaluatorName, status: "install-error" })
      console.error("Joint evaluator capture hook failed", captureError)
    }
  }
  return (): void => {
    for (const { evaluatorName, descriptor } of originals) {
      try {
        Object.defineProperty(joint, evaluatorName, descriptor)
      } catch (captureError) {
        console.error("Joint evaluator capture restore failed", captureError)
      }
    }
  }
}

type DiagnosticMethod = (this: unknown, ...args: unknown[]) => unknown

type PhysicalQueryCounters = {
  calls: number
  returnedTrue: number
  returnedFalse: number
  threw: number
  originalElapsedMs: number
  attributedToSingleCalls: number
  unattributedCalls: number
}

type HdRuntimeDiagnostic = {
  diagnostic: "hd-runtime-observation"
  recentPointKeyLimitPerSingle: number
  observingHighDensity: boolean
  enteredHighDensity: boolean
  observedSingleCount: number
  pointQueries: PhysicalQueryCounters
  segmentQueries: PhysicalQueryCounters
  exactRecentPointRepeatHits: number
  repeatResultDisagreements: number
  recentPointWindowInsertions: number
  recentPointWindowEvictions: number
  pointKeyUnavailableCalls: number
  observationErrors: number
  lastObservationError: string | null
  hooks: { target: string; status: string }[]
  portfolioOutcomes: Record<string, unknown>[]
  limitations: string[]
}

type HdRuntimeObservation = {
  diagnostic: HdRuntimeDiagnostic
  setPhase: (phase: string) => void
  restore: () => void
}

const createPhysicalQueryCounters = (): PhysicalQueryCounters => {
  return {
    calls: 0,
    returnedTrue: 0,
    returnedFalse: 0,
    threw: 0,
    originalElapsedMs: 0,
    attributedToSingleCalls: 0,
    unattributedCalls: 0,
  }
}

const getDiagnosticClassName = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null) return null
  const prototype = Object.getPrototypeOf(value)
  if (!prototype) return null
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor")
  if (!constructor || typeof constructor.value !== "function") return null
  const name = Object.getOwnPropertyDescriptor(constructor.value, "name")
  return typeof name?.value === "string" ? name.value : null
}

const getDiagnosticScalarFields = (
  value: unknown,
): Record<string, string | number | boolean | null> => {
  const result: Record<string, string | number | boolean | null> = {}
  if (typeof value !== "object" || value === null) return result
  for (const [key, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(value),
  )) {
    if (!("value" in descriptor)) continue
    const field = descriptor.value
    if (
      field === null ||
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean"
    ) {
      result[key] = field
    }
  }
  return result
}

/** Isolated diagnostic process only; no routing predicates are memoized. */
const installHdRuntimeObservation = (
  pipeline: Pipeline,
): HdRuntimeObservation => {
  const diagnostic: HdRuntimeDiagnostic = {
    diagnostic: "hd-runtime-observation",
    recentPointKeyLimitPerSingle: 4096,
    observingHighDensity: false,
    enteredHighDensity: false,
    observedSingleCount: 0,
    pointQueries: createPhysicalQueryCounters(),
    segmentQueries: createPhysicalQueryCounters(),
    exactRecentPointRepeatHits: 0,
    repeatResultDisagreements: 0,
    recentPointWindowInsertions: 0,
    recentPointWindowEvictions: 0,
    pointKeyUnavailableCalls: 0,
    observationErrors: 0,
    lastObservationError: null,
    hooks: [],
    portfolioOutcomes: [],
    limitations: [
      "Instrumentation overhead changes diagnostic wall time; this is not a timed benchmark.",
      "Method elapsed includes the original call, not post-call observer bookkeeping; timer overhead and runtime perturbation remain.",
      "Exact repeat hits are a lower bound within a 4096 most-recent-distinct-key window per Single instance; evicted keys are not globally unique.",
      "Point keys include exact numeric XYZ including signed zero, copper diameter, canonical net and physical index identity. Only returned booleans enter the window.",
      "Recent keys live only in a WeakMap keyed by their Single solver; no point lists or solver references are retained in the artifact.",
      "observedSingleCount counts instances with a successfully recorded point key, not all constructed Single solvers.",
      "Portfolio onSolve observations identify that supervisor's selected candidate, not necessarily the final node or board winner; later growth or publication can still fail.",
      "Candidate iteration totals use each candidate's own counter; they are not recursively summed Single search expansions or measured CPU savings.",
      "Selected hyperparameters include existing own scalar fields only; arrays, nested objects and getters are not traversed.",
      "Cache and remote successes that bypass observed Portfolio methods have no inferred candidate work; unavailable methods are reported explicitly.",
      "Hard process termination may leave only the most recent completed-node checkpoint; active unfinished-node work after it is unavailable.",
    ],
  }
  const originals: {
    target: object
    name: string
    descriptor: PropertyDescriptor | undefined
  }[] = []
  const singleWindows = new WeakMap<object, Map<string, boolean>>()
  const registeredSingles = new WeakSet<object>()
  const installedIndexes = new WeakSet<object>()
  const recordedPortfolios = new WeakSet<object>()
  let nextIndexId = 0
  let activeSingle: object | undefined
  let restored = false

  const recordObservationError = (error: unknown): void => {
    diagnostic.observationErrors++
    diagnostic.lastObservationError =
      error instanceof Error ? error.message : String(error)
    if (diagnostic.observationErrors === 1) {
      console.error("HD runtime observation failed", error)
    }
  }

  const wrapMethod = (
    target: object,
    name: string,
    label: string,
    createWrapper: (original: DiagnosticMethod) => DiagnosticMethod,
  ): void => {
    try {
      const ownDescriptor = Object.getOwnPropertyDescriptor(target, name)
      let owner: object | null = target
      let descriptor = ownDescriptor
      while (owner && descriptor === undefined) {
        owner = Object.getPrototypeOf(owner)
        if (owner) descriptor = Object.getOwnPropertyDescriptor(owner, name)
      }
      if (
        !descriptor ||
        !("value" in descriptor) ||
        typeof descriptor.value !== "function"
      ) {
        diagnostic.hooks.push({ target: label, status: "method-unavailable" })
        return
      }
      Object.defineProperty(target, name, {
        ...descriptor,
        value: createWrapper(descriptor.value as DiagnosticMethod),
      })
      originals.push({ target, name, descriptor: ownDescriptor })
      diagnostic.hooks.push({ target: label, status: "installed" })
    } catch (error) {
      diagnostic.hooks.push({ target: label, status: "install-error" })
      recordObservationError(error)
    }
  }

  const observePointResult = (
    query: unknown,
    indexId: number,
    result: boolean,
    single: object,
  ): void => {
    const point = getDiagnosticOwnValue(query, "point")
    const coordinates = [
      getDiagnosticOwnValue(point, "x"),
      getDiagnosticOwnValue(point, "y"),
      getDiagnosticOwnValue(point, "z"),
      getDiagnosticOwnValue(query, "copperDiameter"),
    ]
    const netId = getDiagnosticOwnValue(query, "canonicalNetId")
    if (
      typeof netId !== "string" ||
      coordinates.some(
        (value): boolean =>
          typeof value !== "number" || !Number.isFinite(value),
      )
    ) {
      diagnostic.pointKeyUnavailableCalls++
      return
    }
    const key = JSON.stringify([
      indexId,
      netId,
      ...coordinates.map((value): string =>
        Object.is(value, -0) ? "-0" : String(value),
      ),
    ])
    let window = singleWindows.get(single)
    if (!window) {
      window = new Map<string, boolean>()
      singleWindows.set(single, window)
      diagnostic.observedSingleCount++
    }
    if (window.has(key)) {
      diagnostic.exactRecentPointRepeatHits++
      if (window.get(key) !== result) diagnostic.repeatResultDisagreements++
      window.delete(key)
    } else {
      diagnostic.recentPointWindowInsertions++
      if (window.size === diagnostic.recentPointKeyLimitPerSingle) {
        const oldest = window.keys().next()
        if (!oldest.done) window.delete(oldest.value)
        diagnostic.recentPointWindowEvictions++
      }
    }
    window.set(key, result)
  }

  const installContextIndexes = (context: unknown): void => {
    for (const field of ["traceClearanceIndex", "viaClearanceIndex"]) {
      const index = getDiagnosticOwnValue(context, field)
      if (
        typeof index !== "object" ||
        index === null ||
        installedIndexes.has(index)
      ) {
        continue
      }
      installedIndexes.add(index)
      const indexId = nextIndexId++
      for (const method of ["isPointClear", "isSegmentClear"] as const) {
        const createObservedIndexMethod = (
          original: DiagnosticMethod,
        ): DiagnosticMethod => {
          return function (this: unknown, ...args: unknown[]): unknown {
            if (!diagnostic.observingHighDensity) {
              return original.apply(this, args)
            }
            const single = activeSingle
            const started = performance.now()
            let returned = false
            let result: unknown
            try {
              result = original.apply(this, args)
              returned = true
              return result
            } finally {
              const elapsed = performance.now() - started
              try {
                const counters =
                  method === "isPointClear"
                    ? diagnostic.pointQueries
                    : diagnostic.segmentQueries
                counters.calls++
                counters.originalElapsedMs += elapsed
                if (single) counters.attributedToSingleCalls++
                else counters.unattributedCalls++
                if (!returned) counters.threw++
                else if (result === true) counters.returnedTrue++
                else if (result === false) counters.returnedFalse++
                if (
                  method === "isPointClear" &&
                  single &&
                  typeof result === "boolean" &&
                  returned
                ) {
                  observePointResult(args[0], indexId, result, single)
                }
              } catch (error) {
                recordObservationError(error)
              }
            }
          }
        }
        wrapMethod(
          index,
          method,
          `index${indexId}.${field}.${method}`,
          createObservedIndexMethod,
        )
      }
    }
  }

  for (const method of [
    "isPhysicalTracePointClear",
    "isPhysicalTraceSegmentClear",
    "isPhysicalViaClear",
  ]) {
    const createObservedSingleMethod = (
      original: DiagnosticMethod,
    ): DiagnosticMethod => {
      return function (this: unknown, ...args: unknown[]): unknown {
        const previousSingle = activeSingle
        try {
          if (
            diagnostic.observingHighDensity &&
            typeof this === "object" &&
            this !== null
          ) {
            activeSingle = this
            if (!registeredSingles.has(this)) {
              installContextIndexes(
                getDiagnosticOwnValue(this, "physicalClearanceContext"),
              )
              registeredSingles.add(this)
            }
          }
        } catch (error) {
          recordObservationError(error)
        }
        try {
          return original.apply(this, args)
        } finally {
          activeSingle = previousSingle
        }
      }
    }
    wrapMethod(
      SingleHighDensityRouteSolver.prototype,
      method,
      `Single.${method}`,
      createObservedSingleMethod,
    )
  }

  const capturePortfolio = (
    portfolio: object,
    selected: unknown,
    outcome: string,
  ): void => {
    if (recordedPortfolios.has(portfolio)) return
    recordedPortfolios.add(portfolio)
    const candidates = getDiagnosticOwnValue(portfolio, "supervisedSolvers")
    const workByClass: Record<
      string,
      { count: number; iterations: number; solved: number; failed: number }
    > = {}
    let totalCandidateIterations = 0
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        const solver = getDiagnosticOwnValue(candidate, "solver")
        const className = getDiagnosticClassName(solver) ?? "unavailable"
        const iterations = getDiagnosticOwnValue(solver, "iterations")
        if (!workByClass[className]) {
          workByClass[className] = {
            count: 0,
            iterations: 0,
            solved: 0,
            failed: 0,
          }
        }
        const work = workByClass[className]!
        work.count++
        if (typeof iterations === "number") {
          work.iterations += iterations
          totalCandidateIterations += iterations
        }
        if (getDiagnosticOwnValue(solver, "solved") === true) work.solved++
        if (getDiagnosticOwnValue(solver, "failed") === true) work.failed++
      }
    }
    const winner = getDiagnosticOwnValue(selected, "solver")
    const node = getDiagnosticOwnValue(portfolio, "nodeWithPortPoints")
    diagnostic.portfolioOutcomes.push({
      outcome,
      nodeId: getDiagnosticOwnValue(node, "capacityMeshNodeId") ?? null,
      portfolioClass: getDiagnosticClassName(portfolio),
      portfolioIterations:
        getDiagnosticOwnValue(portfolio, "iterations") ?? null,
      candidateCount: Array.isArray(candidates) ? candidates.length : null,
      totalCandidateIterations,
      workByClass,
      selectedClass: getDiagnosticClassName(winner),
      selectedIterations: getDiagnosticOwnValue(winner, "iterations") ?? null,
      selectedScalarHyperParameters: getDiagnosticScalarFields(
        getDiagnosticOwnValue(selected, "hyperParameters"),
      ),
    })
  }
  for (const method of ["onSolve", "_step"] as const) {
    const createObservedPortfolioMethod = (
      original: DiagnosticMethod,
    ): DiagnosticMethod => {
      return function (this: unknown, ...args: unknown[]): unknown {
        let returned = false
        try {
          const result = original.apply(this, args)
          returned = true
          return result
        } finally {
          try {
            if (
              diagnostic.observingHighDensity &&
              typeof this === "object" &&
              this !== null
            ) {
              if (method === "onSolve") {
                capturePortfolio(
                  this,
                  args[0],
                  returned ? "onSolve-returned" : "onSolve-threw",
                )
              } else if (
                !returned ||
                getDiagnosticOwnValue(this, "failed") === true
              ) {
                capturePortfolio(
                  this,
                  undefined,
                  returned ? "failed-step" : "step-threw",
                )
              }
            }
          } catch (error) {
            recordObservationError(error)
          }
        }
      }
    }
    wrapMethod(
      PortfolioSingleIntraNodeSolver.prototype,
      method,
      `Portfolio.${method}`,
      createObservedPortfolioMethod,
    )
  }
  return {
    diagnostic,
    setPhase: (phase): void => {
      diagnostic.observingHighDensity = phase === "highDensityRouteSolver"
      if (!diagnostic.observingHighDensity || diagnostic.enteredHighDensity) {
        return
      }
      diagnostic.enteredHighDensity = true
      try {
        const context = getDiagnosticOwnValue(pipeline, "fixedPadClearance")
        if (context === undefined) {
          diagnostic.hooks.push({
            target: "Pipeline.fixedPadClearance",
            status: "context-unavailable-at-hd-entry",
          })
        } else {
          installContextIndexes(context)
        }
      } catch (error) {
        recordObservationError(error)
      }
    },
    restore: (): void => {
      diagnostic.observingHighDensity = false
      if (restored) return
      restored = true
      for (const original of originals.reverse()) {
        try {
          if (original.descriptor) {
            Object.defineProperty(
              original.target,
              original.name,
              original.descriptor,
            )
          } else {
            if (!Reflect.deleteProperty(original.target, original.name)) {
              throw new Error(
                `HD runtime observer could not restore ${original.name}`,
              )
            }
          }
        } catch (error) {
          recordObservationError(error)
        }
      }
      originals.length = 0
    },
  }
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
  const observeRegional = process.env.HD_DRC_REGIONAL_OBSERVATION === "1"
  const regionalObservations = new WeakMap<
    object,
    RegionalBoundaryObservation
  >()
  let regionalOrdinal = 0
  const writeRegionalBoundary = async (
    observation: RegionalStepObservation | null,
    event: "normal-step" | "step-threw",
    error: unknown,
  ): Promise<void> => {
    if (!observation) return
    try {
      const { entry } = observation
      const phaseAfter = getDiagnosticOwnValue(entry.solver, "phase")
      if (
        event === "normal-step" &&
        phaseAfter === observation.phaseBefore &&
        getDiagnosticOwnValue(entry.solver, "failed") !== true
      ) {
        return
      }
      const sequence = entry.boundaryCount++
      await writeFile(
        path.join(
          outputDir,
          `regional-boundary-${entry.ordinal}-${sequence}.json`,
        ),
        JSON.stringify({
          diagnostic: "regional-boundary",
          dataset: datasetArg,
          sample,
          pipeline: pipelineArg,
          regionalOrdinal: entry.ordinal,
          sequence,
          event,
          phaseBefore: observation.phaseBefore ?? null,
          phaseAfter: phaseAfter ?? null,
          error:
            event === "step-threw"
              ? error instanceof Error
                ? error.message
                : String(error)
              : null,
          stack: error instanceof Error ? (error.stack ?? null) : null,
          ...captureRegionalBoundaryData(observation),
          limitations: [
            "Snapshots are observed after one normal pipeline step, not interceptions of constructor-local arguments.",
            "A route-to-improve boundary is after force construction; originalHdRoutes is the force instance's retained input.",
            "At improve-to-repair, repair.originalHdRoutes is the result of the regional solver's existing force output call.",
            "Repair inputs and sparse override entries are captured separately; no output is reconstructed or requested.",
            "Grow's winning portfolio retains solve-space routes; successful Grow routes are the separately accepted inverse-scaled routes (the same array at scale one).",
            "Missing descriptors or unobserved successful Grow state are unavailable, not empty geometry.",
          ],
        }),
      )
    } catch (captureError) {
      // Observation cannot change the original routing result or exception.
      console.error("regional boundary capture failed", captureError)
    }
  }
  let mergedCapacityNodes: CapacityNodeCapture[] | null = null
  const repair04InvalidOutputs: Repair04InvalidOutputCapture[] = []
  const jointEvaluatorDiagnostic: JointEvaluatorDiagnostic = {
    hooks: [],
    callCount: 0,
    observations: [],
    failure: null,
  }
  let restoreJointEvaluators: (() => void) | undefined
  let uniformFailureDiagnostic: UniformFailureDiagnostic | undefined
  let tinyFailureDiagnostic: TinyFailureDiagnostic | undefined
  let previousPathingWrapper: unknown
  let previousPathingActiveSolver: unknown
  const hdRuntimeObservation =
    process.env.HD_DRC_RUNTIME_OBSERVATION === "1"
      ? installHdRuntimeObservation(pipeline)
      : undefined
  const writeRuntimeObservation = async (checkpoint: string): Promise<void> => {
    if (!hdRuntimeObservation) return
    try {
      await writeFile(
        path.join(outputDir, "hd-runtime-observation.json"),
        JSON.stringify({
          dataset: datasetArg,
          sample,
          pipeline: pipelineArg,
          checkpoint,
          phase:
            pipeline.pipelineDef[pipeline.currentPipelineStepIndex]?.solverName,
          solved: pipeline.solved,
          failed: pipeline.failed,
          error: pipeline.error,
          ...hdRuntimeObservation.diagnostic,
        }),
      )
    } catch (artifactError) {
      console.error(
        "HD runtime observation artifact write failed",
        artifactError,
      )
    }
  }
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
      hdRuntimeObservation?.setPhase(phase)
      if (
        phase === "pipeline9JointDrcRepairSolver" &&
        pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph &&
        pipeline.pipeline9JointDrcRepairSolver &&
        restoreJointEvaluators === undefined
      ) {
        // Pipeline construction and advancement occur on separate normal
        // steps, so these instance hooks are installed before Joint advances.
        restoreJointEvaluators = installJointEvaluatorInputCapture(
          pipeline,
          jointEvaluatorDiagnostic,
        )
      }
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
      let regionalObservation: RegionalStepObservation | null = null
      if (observeRegional && phase === "highDensityRouteSolver") {
        try {
          const regional = getDiagnosticOwnValue(hd, "activeFallbackSolver")
          if (typeof regional === "object" && regional !== null) {
            let entry = regionalObservations.get(regional)
            if (!entry) {
              entry = {
                ordinal: regionalOrdinal++,
                boundaryCount: 0,
                solver: regional,
                highDensitySolver: getDiagnosticOwnValue(
                  regional,
                  "highDensitySolver",
                ),
                grow: null,
              }
              regionalObservations.set(regional, entry)
            }
            const regionalGrow = getDiagnosticOwnValue(
              entry.highDensitySolver,
              "activeSubSolver",
            )
            if (regionalGrow instanceof GrowShrinkHighDensityIntraNodeSolver) {
              entry.grow = regionalGrow
            }
            regionalObservation = {
              entry,
              phaseBefore: getDiagnosticOwnValue(regional, "phase"),
              outerHd: hd,
              outerRouteStart: routeStart,
            }
          }
        } catch (captureError) {
          console.error("regional reference observation failed", captureError)
        }
      }
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
        if (regionalObservation) {
          await writeRegionalBoundary(regionalObservation, "step-threw", error)
        }
        if (
          pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph &&
          (phase === "highDensityForceImproveSolver" ||
            pipeline.getCurrentPhase() === "highDensityForceImproveSolver")
        ) {
          try {
            const forceDescriptor = Object.getOwnPropertyDescriptor(
              pipeline,
              "highDensityForceImproveSolver",
            )
            const forceInstance = getDiagnosticOwnValue(
              pipeline,
              "highDensityForceImproveSolver",
            )
            await writeFile(
              path.join(outputDir, "high-density-force-step-failure.json"),
              JSON.stringify({
                diagnostic: "high-density-force-step-failure",
                dataset: datasetArg,
                sample,
                pipeline: pipelineArg,
                phaseBeforeStep: phase,
                phaseAfterStep: pipeline.getCurrentPhase(),
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? (error.stack ?? null) : null,
                pipelineState: selectDiagnosticOwnFields(pipeline, [
                  "solved",
                  "failed",
                  "error",
                ]),
                outerForceOwnFieldStatus:
                  forceDescriptor === undefined
                    ? "absent-own-field"
                    : "value" in forceDescriptor
                      ? "observed-own-data-field"
                      : "unsupported-own-accessor",
                outerForceInstancePresent:
                  forceDescriptor === undefined || "value" in forceDescriptor
                    ? typeof forceInstance === "object" &&
                      forceInstance !== null
                    : null,
                outerForceState: selectDiagnosticOwnFields(forceInstance, [
                  "solved",
                  "failed",
                  "iterations",
                  "error",
                ]),
                limitations: [
                  "The phase name can identify constructor input preparation before a force instance exists.",
                  "No force output is requested during failure capture; completed force output uses the existing stage artifact.",
                  "Regional inner-stage provenance is unavailable unless separately observed.",
                ],
              }),
            )
          } catch (captureError) {
            // Preserve the same solver exception, even if artifact I/O fails.
            console.error(
              "high-density force failure capture failed",
              captureError,
            )
          }
        }
        if (pipeline.getCurrentPhase() === "pipeline9JointDrcRepairSolver") {
          jointEvaluatorDiagnostic.failure = {
            phase: pipeline.getCurrentPhase(),
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? (error.stack ?? null) : null,
          }
        }
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
      if (regionalObservation) {
        try {
          if (
            getDiagnosticOwnValue(regionalObservation.entry.solver, "phase") !==
              regionalObservation.phaseBefore ||
            getDiagnosticOwnValue(
              regionalObservation.entry.solver,
              "failed",
            ) === true
          ) {
            await writeRegionalBoundary(
              regionalObservation,
              "normal-step",
              null,
            )
          }
        } catch (captureError) {
          console.error("regional boundary observation failed", captureError)
        }
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
        if (hdRuntimeObservation) {
          await writeRuntimeObservation("completed-node")
        }
      }
      if (pipeline.getCurrentPhase() !== phase) {
        if (
          phase === "highDensityRouteSolver" &&
          pipeline instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
        ) {
          try {
            // Serialize raw copper before conversion/evaluation and before the
            // next normal pipeline step prepares the outer force constructor.
            await writeFile(
              path.join(outputDir, "high-density-raw-invalid-transitions.json"),
              JSON.stringify({
                diagnostic: "high-density-raw-invalid-transitions",
                dataset: datasetArg,
                sample,
                pipeline: pipelineArg,
                phase,
                nextPhase: pipeline.getCurrentPhase(),
                ...captureInvalidRawHdTransitions(pipeline, nodes),
                limitations: [
                  "Raw outer-HD output can include an existing regional solver's internal force and repair stages.",
                  "Producer metadata is attached only through retained route object identity, not connection-name inference.",
                  "Only transitions rejected by the current materializer predicate are retained; no route is changed or replayed.",
                ],
              }),
            )
          } catch (captureError) {
            console.error(
              "raw high-density transition capture failed",
              captureError,
            )
          }
        }
        if (phase === "highDensityRouteSolver" && hdRuntimeObservation) {
          hdRuntimeObservation.restore()
          await writeRuntimeObservation("high-density-complete")
        }
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
    restoreJointEvaluators?.()
    hdRuntimeObservation?.restore()
    if (hdRuntimeObservation) {
      await writeRuntimeObservation("final-or-failure")
    }
    if (
      pipeline.failed &&
      pipeline.getCurrentPhase() === "pipeline9JointDrcRepairSolver" &&
      jointEvaluatorDiagnostic.failure === null
    ) {
      jointEvaluatorDiagnostic.failure = {
        phase: pipeline.getCurrentPhase(),
        message: String(pipeline.error),
        stack: null,
      }
    }
    if (
      jointEvaluatorDiagnostic.failure ||
      jointEvaluatorDiagnostic.observations.length > 0
    ) {
      try {
        await writeFile(
          path.join(outputDir, "joint-evaluator-invalid-input.json"),
          JSON.stringify({
            diagnostic: "joint-evaluator-invalid-input",
            dataset: datasetArg,
            sample,
            pipeline: pipelineArg,
            ...jointEvaluatorDiagnostic,
            limitations: [
              "An evaluator input may be a rejected candidate; observation does not establish acceptance.",
              "Input route indexes address the observed evaluator array, not an inferred source-board mapping.",
              "Call stacks identify observed callers; stack-local extraction routes and accepted region counts are not retained by this hook.",
              "Constructor-captured callback references are not replaced; only calls through the observed Joint instance fields are intercepted.",
              "Only noncolocated ordinary layer transitions are captured; explicit through-obstacle transitions are excluded.",
            ],
          }),
        )
      } catch (artifactError) {
        console.error(
          "Joint evaluator capture artifact write failed",
          artifactError,
        )
      }
    }
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
      if (process.env.HD_DRC_STATIC_REACHABILITY_CERTIFICATE === "1") {
        try {
          // Observation is restored above. Analyze only the completed capture,
          // never a live solver, its queues, or a reconstructed routing pass.
          const certificate = createTinyStaticReachabilityCertificate(
            JSON.parse(tinyFailureDiagnostic.serialized),
          )
          await writeFile(
            path.join(outputDir, "tiny-static-reachability.json"),
            JSON.stringify({
              dataset: datasetArg,
              sample,
              pipeline: pipelineArg,
              ...certificate,
            }),
          )
          console.error(
            JSON.stringify({
              diagnostic: certificate.diagnostic,
              status: certificate.status,
              model: certificate.model,
              elapsedMs: certificate.elapsedMs,
              instances: certificate.instances.map(
                (instance): Record<string, unknown> =>
                  instance.status === "complete"
                    ? {
                        source: instance.source,
                        attemptedNeverSuccessfulCount:
                          instance.attemptedNeverSuccessfulCount,
                        disconnectedCount: instance.routes.filter(
                          (route): boolean =>
                            route.status === "disconnected-in-optimistic-graph",
                        ).length,
                      }
                    : instance,
              ),
            }),
          )
        } catch (certificateError) {
          // Diagnostic failure must not replace the original solver outcome.
          console.error("tiny static certificate failed", certificateError)
        }
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
