import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import {
  GlobalDrcBranchPortfolioSolver,
  type DrcEvaluator,
} from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { assignUniquePcbTraceIdsToNewTraces } from "./assign-unique-pcb-trace-ids-to-new-traces"
import {
  convertPreloadedTraceToHdRoutes,
  type PreloadedHighDensityRoute,
} from "./convert-preloaded-traces-to-hd-routes"
import { applyPipeline9RegionalB01Repairs } from "./apply-pipeline9-regional-b01-repairs"
import { applyPipeline9TerminalEscapeRelocations } from "./apply-pipeline9-terminal-escape-relocations"
import { normalizePipeline9DrcErrorsForRepair } from "./normalize-pipeline9-drc-errors-for-repair"
import { preparePipeline9DrcRoutedTracesWithMetadata } from "./prepare-pipeline9-drc-routed-traces"
import { getPipeline9PreloadedTraceIdsInInitialDrcRegions } from "./get-pipeline9-preloaded-trace-ids-in-initial-drc-regions"
import { mergePipeline9MovablePreloadedVias } from "./merge-pipeline9-movable-preloaded-vias"
import { getPipeline9PreloadedViaPairTraceGroups } from "./get-pipeline9-preloaded-via-pair-trace-groups"

type Pipeline9JointDrcRepairSolverParams = {
  srj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  originalSrj: SimpleRouteJson
  newConnections: SimpleRouteConnection[]
  newHdRoutes: HighDensityRoute[]
  updatedPreloadedTraces: SimplifiedPcbTrace[]
  mutatedPreloadedTraceIds: ReadonlySet<string>
  connMap: ConnectivityMap
  obstacles: Obstacle[]
  layerCount: number
  defaultViaDiameter: number
  defaultViaHoleDiameter: number
  effort: number
  colorMap: Record<string, string>
}

type MovablePreloadedTrace = {
  originalTrace: SimplifiedPcbTrace
  syntheticConnectionName: string
  hdRoute: HighDensityRoute
}

const POINT_EPSILON = 1e-9

const pointsAreEqual = (
  left: HighDensityRoute["route"][number],
  right: HighDensityRoute["route"][number],
) =>
  Math.abs(left.x - right.x) <= POINT_EPSILON &&
  Math.abs(left.y - right.y) <= POINT_EPSILON &&
  left.z === right.z

const pointsHaveSamePosition = (
  left: HighDensityRoute["route"][number],
  right: HighDensityRoute["route"][number],
) =>
  Math.abs(left.x - right.x) <= POINT_EPSILON &&
  Math.abs(left.y - right.y) <= POINT_EPSILON

const convertPreloadedTraceToSingleHdRoute = ({
  trace,
  traceIndex,
  syntheticConnectionName,
  layerCount,
  defaultViaDiameter,
  connMap,
}: {
  trace: SimplifiedPcbTrace
  traceIndex: number
  syntheticConnectionName: string
  layerCount: number
  defaultViaDiameter: number
  connMap: ConnectivityMap
}): HighDensityRoute => {
  if (
    trace.route.some(
      (routePoint) => routePoint.route_type === "through_obstacle",
    )
  ) {
    throw new Error(
      `Pipeline9 cannot exactly repair through-obstacle preloaded trace "${trace.pcb_trace_id}"`,
    )
  }

  const traceSections = convertPreloadedTraceToHdRoutes(
    trace,
    traceIndex,
    layerCount,
    defaultViaDiameter,
    connMap,
  )
  if (traceSections.length === 0) {
    throw new Error(
      `Pipeline9 cannot exactly repair empty preloaded trace "${trace.pcb_trace_id}"`,
    )
  }

  const route: HighDensityRoute["route"] = []
  for (const section of traceSections) {
    if (route.length === 0) {
      route.push(...section.route)
      continue
    }
    const previousEnd = route.at(-1)!
    if (section.route[0] && pointsAreEqual(previousEnd, section.route[0])) {
      route.push(...section.route.slice(1))
      continue
    }
    if (
      section.route.at(-1) &&
      pointsAreEqual(previousEnd, section.route.at(-1)!)
    ) {
      route.push(...section.route.slice(0, -1).reverse())
      continue
    }
    throw new Error(
      `Pipeline9 cannot reconnect preloaded trace "${trace.pcb_trace_id}" for exact repair`,
    )
  }

  const startPcbPortId = trace.connectsTo?.[0]
  const endPcbPortId = trace.connectsTo?.at(-1)
  if (typeof startPcbPortId === "string" && route[0]) {
    route[0] = { ...route[0], pcb_port_id: startPcbPortId }
  }
  if (typeof endPcbPortId === "string" && route.at(-1)) {
    route[route.length - 1] = {
      ...route.at(-1)!,
      pcb_port_id: endPcbPortId,
    }
  }

  return {
    connectionName: syntheticConnectionName,
    rootConnectionName:
      connMap.getNetConnectedToId(trace.connection_name) ??
      trace.connection_name,
    traceThickness: Math.max(
      ...traceSections.map((section) => section.traceThickness),
    ),
    viaDiameter: Math.max(
      ...traceSections.map((section) => section.viaDiameter),
    ),
    route,
    vias: route.slice(0, -1).flatMap((point, pointIndex) => {
      const nextPoint = route[pointIndex + 1]!
      return point.z !== nextPoint.z && pointsHaveSamePosition(point, nextPoint)
        ? [{ x: nextPoint.x, y: nextPoint.y }]
        : []
    }),
  }
}

const getTraceIdsFromDrcErrors = ({
  errors,
  circuitJson,
}: {
  errors: Array<Record<string, unknown>>
  circuitJson: AnyCircuitElement[]
}): Set<string> => {
  const traceIdByViaId = new Map(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.pcb_trace_id === "string"
        ? [[element.pcb_via_id, element.pcb_trace_id] as const]
        : [],
    ),
  )
  const traceIds = new Set<string>()
  for (const error of errors) {
    const primaryTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    if (typeof error.pcb_trace_id === "string") {
      traceIds.add(error.pcb_trace_id)
    }
    if (Array.isArray(error.pcb_trace_ids)) {
      for (const traceId of error.pcb_trace_ids) {
        if (typeof traceId === "string") traceIds.add(traceId)
      }
    }
    if (typeof error.pcb_via_id === "string") {
      const traceId = traceIdByViaId.get(error.pcb_via_id)
      if (traceId) traceIds.add(traceId)
    }
    if (Array.isArray(error.pcb_via_ids)) {
      for (const viaId of error.pcb_via_ids) {
        if (typeof viaId !== "string") continue
        const traceId = traceIdByViaId.get(viaId)
        if (traceId) traceIds.add(traceId)
      }
    }
    const pairPrefix = primaryTraceId ? `overlap_${primaryTraceId}_` : undefined
    if (
      pairPrefix &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(pairPrefix)
    ) {
      traceIds.add(error.pcb_trace_error_id.slice(pairPrefix.length))
    }
  }
  return traceIds
}

const remapDrcTraceIds = (
  errors: Array<Record<string, unknown>>,
  solverTraceIdByEvaluationTraceId: ReadonlyMap<string, string>,
): Array<Record<string, unknown>> =>
  errors.map((error) => {
    const explicitEvaluationTraceIds = Array.isArray(error.pcb_trace_ids)
      ? error.pcb_trace_ids.filter(
          (traceId): traceId is string => typeof traceId === "string",
        )
      : []
    const primaryEvaluationTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    const pairPrefix = primaryEvaluationTraceId
      ? `overlap_${primaryEvaluationTraceId}_`
      : undefined
    const encodedOtherEvaluationTraceId =
      pairPrefix &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(pairPrefix)
        ? error.pcb_trace_error_id.slice(pairPrefix.length)
        : undefined
    const evaluationTraceIds = [
      ...(primaryEvaluationTraceId ? [primaryEvaluationTraceId] : []),
      ...explicitEvaluationTraceIds,
      ...(encodedOtherEvaluationTraceId ? [encodedOtherEvaluationTraceId] : []),
    ].filter(
      (traceId, traceIndex, traceIds) =>
        traceIds.indexOf(traceId) === traceIndex,
    )
    const primarySolverTraceId = primaryEvaluationTraceId
      ? solverTraceIdByEvaluationTraceId.get(primaryEvaluationTraceId)
      : undefined
    const solverTraceIds = evaluationTraceIds.flatMap((traceId) => {
      const solverTraceId = solverTraceIdByEvaluationTraceId.get(traceId)
      return solverTraceId ? [solverTraceId] : []
    })
    return {
      ...error,
      ...(primarySolverTraceId ? { pcb_trace_id: primarySolverTraceId } : {}),
      ...(solverTraceIds.length > 0 ? { pcb_trace_ids: solverTraceIds } : {}),
      ...(solverTraceIds.length >= 2
        ? {
            pcb_trace_error_id: `overlap_${solverTraceIds[0]}_${solverTraceIds[1]}`,
          }
        : {}),
    }
  })

const createSyntheticConnection = (
  movableTrace: MovablePreloadedTrace,
  layerCount: number,
): SimpleRouteConnection => {
  const start = movableTrace.hdRoute.route[0]!
  const end = movableTrace.hdRoute.route.at(-1)!
  return {
    name: movableTrace.syntheticConnectionName,
    rootConnectionName: movableTrace.hdRoute.rootConnectionName,
    __netConnectionName: movableTrace.originalTrace.connection_name,
    nominalTraceWidth: movableTrace.hdRoute.traceThickness,
    pointsToConnect: [
      {
        x: start.x,
        y: start.y,
        layer: mapZToLayerName(start.z, layerCount),
        pointId: `${movableTrace.syntheticConnectionName}:start`,
      },
      {
        x: end.x,
        y: end.y,
        layer: mapZToLayerName(end.z, layerCount),
        pointId: `${movableTrace.syntheticConnectionName}:end`,
      },
    ],
  }
}

/**
 * Gives the existing exact DRC portfolio ownership of only the preloaded
 * traces that participate in a remaining joint-output DRC error.
 */
export class Pipeline9JointDrcRepairSolver extends BaseSolver {
  readonly params: Pipeline9JointDrcRepairSolverParams
  readonly inputNewHdRoutes: HighDensityRoute[]
  readonly inputUpdatedPreloadedTraces: SimplifiedPcbTrace[]
  readonly movablePreloadedTraces: MovablePreloadedTrace[]
  readonly fixedPreloadedObstacleRoutes: PreloadedHighDensityRoute[]
  readonly syntheticConnectionNames: ReadonlySet<string>
  readonly exactRepairSolver?: GlobalDrcBranchPortfolioSolver
  private drcEvaluator?: DrcEvaluator
  private combinedOutput?: HighDensityRoute[]

  constructor(params: Pipeline9JointDrcRepairSolverParams) {
    super()
    this.params = params
    this.inputNewHdRoutes = params.newHdRoutes
    this.inputUpdatedPreloadedTraces = params.updatedPreloadedTraces

    const currentMutatedPreloadedTraces = params.updatedPreloadedTraces.filter(
      (trace) => params.mutatedPreloadedTraceIds.has(trace.pcb_trace_id),
    )
    const currentNewTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: params.newConnections,
      originalConnections: params.originalSrj.connections,
      hdRoutes: params.newHdRoutes,
      layerCount: params.layerCount,
      obstacles: params.obstacles,
      defaultViaHoleDiameter: params.defaultViaHoleDiameter,
      connMap: params.connMap,
    })
    const preparedCurrentOutput = preparePipeline9DrcRoutedTracesWithMetadata({
      originalPreloadedTraces: params.originalSrj.traces ?? [],
      mutatedPreloadedTraces: currentMutatedPreloadedTraces,
      newTraces: currentNewTraces,
    })
    const currentDrc = evaluateRelaxedDrc({
      inputSrj: params.originalSrj,
      srjWithPointPairs: params.srjWithPointPairs,
      routedTraces: preparedCurrentOutput.routedTraces,
    })
    const preparedTraceIdsInErrors = getTraceIdsFromDrcErrors({
      errors: currentDrc.errors as unknown as Array<Record<string, unknown>>,
      circuitJson: currentDrc.circuitJson,
    })
    const updatedPreloadedTraceById = new Map(
      params.updatedPreloadedTraces.map((trace) => [trace.pcb_trace_id, trace]),
    )
    const movablePreloadedTraceIds = new Set<string>()
    for (const preparedTraceId of preparedTraceIdsInErrors) {
      const originalTraceId =
        preparedCurrentOutput.originalPreloadedTraceIdByPreparedTraceId.get(
          preparedTraceId,
        ) ?? preparedTraceId
      if (updatedPreloadedTraceById.has(originalTraceId)) {
        movablePreloadedTraceIds.add(originalTraceId)
      }
    }
    for (const traceId of getPipeline9PreloadedTraceIdsInInitialDrcRegions({
      errorsWithCenters: currentDrc.errorsWithCenters as unknown as Array<
        Record<string, unknown>
      >,
      traces: params.updatedPreloadedTraces,
      layerCount: params.layerCount,
      defaultViaDiameter: params.defaultViaDiameter,
      connMap: params.connMap,
    })) {
      movablePreloadedTraceIds.add(traceId)
    }

    this.movablePreloadedTraces = [...movablePreloadedTraceIds].map(
      (traceId, movableTraceIndex) => {
        const originalTrace = updatedPreloadedTraceById.get(traceId)!
        const originalTraceIndex = params.updatedPreloadedTraces.findIndex(
          (trace) => trace.pcb_trace_id === traceId,
        )
        const syntheticConnectionName = `pipeline9_preloaded_drc_${movableTraceIndex}`
        return {
          originalTrace,
          syntheticConnectionName,
          hdRoute: convertPreloadedTraceToSingleHdRoute({
            trace: originalTrace,
            traceIndex: originalTraceIndex,
            syntheticConnectionName,
            layerCount: params.layerCount,
            defaultViaDiameter: params.defaultViaDiameter,
            connMap: params.connMap,
          }),
        }
      },
    )
    this.syntheticConnectionNames = new Set(
      this.movablePreloadedTraces.map(
        (movableTrace) => movableTrace.syntheticConnectionName,
      ),
    )
    this.fixedPreloadedObstacleRoutes = params.updatedPreloadedTraces.flatMap(
      (trace, traceIndex) =>
        movablePreloadedTraceIds.has(trace.pcb_trace_id)
          ? []
          : convertPreloadedTraceToHdRoutes(
              trace,
              traceIndex,
              params.layerCount,
              params.defaultViaDiameter,
              params.connMap,
            ),
    )
    const movableTraceIndexByOriginalTraceId = new Map(
      this.movablePreloadedTraces.map((movableTrace, movableTraceIndex) => [
        movableTrace.originalTrace.pcb_trace_id,
        movableTraceIndex,
      ]),
    )
    for (const originalTraceIds of getPipeline9PreloadedViaPairTraceGroups({
      errors: currentDrc.errors as unknown as Array<Record<string, unknown>>,
      circuitJson: currentDrc.circuitJson,
      originalTraceIdByPreparedTraceId:
        preparedCurrentOutput.originalPreloadedTraceIdByPreparedTraceId,
    })) {
      const movableTraceIndexes = originalTraceIds.flatMap((traceId) => {
        const movableTraceIndex =
          movableTraceIndexByOriginalTraceId.get(traceId)
        return movableTraceIndex === undefined ? [] : [movableTraceIndex]
      })
      if (movableTraceIndexes.length === 0) continue
      const movableTraceIndexSet = new Set(movableTraceIndexes)
      const mergedRoutes = mergePipeline9MovablePreloadedVias({
        routes: movableTraceIndexes.map(
          (movableTraceIndex) =>
            this.movablePreloadedTraces[movableTraceIndex]!.hdRoute,
        ),
        otherHdRoutes: [
          ...params.newHdRoutes,
          ...this.fixedPreloadedObstacleRoutes,
          ...this.movablePreloadedTraces.flatMap(
            (movableTrace, movableTraceIndex) =>
              movableTraceIndexSet.has(movableTraceIndex)
                ? []
                : [movableTrace.hdRoute],
          ),
        ],
        obstacles: params.obstacles,
        colorMap: params.colorMap,
        layerCount: params.layerCount,
        connMap: params.connMap,
      })
      for (
        let groupIndex = 0;
        groupIndex < movableTraceIndexes.length;
        groupIndex++
      ) {
        this.movablePreloadedTraces[movableTraceIndexes[groupIndex]!]!.hdRoute =
          mergedRoutes[groupIndex]!
      }
    }
    this.stats = {
      initialJointDrcIssueCount: currentDrc.errors.length,
      movablePreloadedTraceCount: this.movablePreloadedTraces.length,
    }

    if (currentDrc.errors.length === 0) {
      this.solved = true
      return
    }

    const movableOriginalTraceIds = new Set(
      this.movablePreloadedTraces.map(
        (movableTrace) => movableTrace.originalTrace.pcb_trace_id,
      ),
    )
    const nonMovableMutatedPreloadedTraces =
      currentMutatedPreloadedTraces.filter(
        (trace) => !movableOriginalTraceIds.has(trace.pcb_trace_id),
      )
    const syntheticConnectionByName = new Map(
      this.movablePreloadedTraces.map((movableTrace) => [
        movableTrace.syntheticConnectionName,
        createSyntheticConnection(movableTrace, params.layerCount),
      ]),
    )
    const extendedSrjWithPointPairs: SimpleRouteJson = {
      ...params.srjWithPointPairs,
      connections: [
        ...params.srjWithPointPairs.connections,
        ...syntheticConnectionByName.values(),
      ],
    }

    const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
      const evaluatedRoutes = routes ?? hdRoutes
      if (!evaluatedRoutes) {
        throw new Error("Pipeline9 joint DRC repair requires HD routes")
      }
      const evaluatedNewRoutes = evaluatedRoutes.filter(
        (route) => !this.syntheticConnectionNames.has(route.connectionName),
      )
      const evaluatedNewTraces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
        connections: params.newConnections,
        originalConnections: params.originalSrj.connections,
        hdRoutes: evaluatedNewRoutes,
        layerCount: params.layerCount,
        obstacles: params.obstacles,
        defaultViaHoleDiameter: params.defaultViaHoleDiameter,
        connMap: params.connMap,
      })
      const uniquelyNamedNewTraces = assignUniquePcbTraceIdsToNewTraces(
        evaluatedNewTraces,
        params.originalSrj.traces ?? [],
      )
      const evaluatedMovablePreloadedTraces = this.movablePreloadedTraces.map(
        (movableTrace) => {
          const evaluatedRoute = evaluatedRoutes.find(
            (route) =>
              route.connectionName === movableTrace.syntheticConnectionName,
          )
          if (!evaluatedRoute) {
            throw new Error(
              `Pipeline9 joint DRC repair lost preloaded route "${movableTrace.originalTrace.pcb_trace_id}"`,
            )
          }
          return {
            ...movableTrace.originalTrace,
            __replaces_pcb_trace_id: movableTrace.originalTrace.pcb_trace_id,
            route: convertHdRouteToSimplifiedRoute(
              evaluatedRoute,
              params.layerCount,
              {
                defaultViaHoleDiameter: params.defaultViaHoleDiameter,
                obstacles: params.obstacles,
                connMap: params.connMap,
              },
            ),
          }
        },
      )
      const solverTraceIdByEvaluationTraceId = new Map<string, string>()
      for (
        let traceIndex = 0;
        traceIndex < evaluatedNewTraces.length;
        traceIndex++
      ) {
        solverTraceIdByEvaluationTraceId.set(
          uniquelyNamedNewTraces[traceIndex]!.pcb_trace_id,
          evaluatedNewTraces[traceIndex]!.pcb_trace_id,
        )
      }
      for (const movableTrace of this.movablePreloadedTraces) {
        solverTraceIdByEvaluationTraceId.set(
          movableTrace.originalTrace.pcb_trace_id,
          `${movableTrace.syntheticConnectionName}_0`,
        )
      }
      const movableTraceIds = new Set(solverTraceIdByEvaluationTraceId.values())
      const evaluatedDrc = evaluateRelaxedDrc({
        inputSrj: params.originalSrj,
        srjWithPointPairs: params.srjWithPointPairs,
        routedTraces: [
          ...nonMovableMutatedPreloadedTraces,
          ...evaluatedMovablePreloadedTraces,
          ...uniquelyNamedNewTraces,
        ],
      })
      const remappedCircuitJson = evaluatedDrc.circuitJson.map((element) => {
        if (
          !("pcb_trace_id" in element) ||
          typeof element.pcb_trace_id !== "string"
        )
          return element
        const solverTraceId = solverTraceIdByEvaluationTraceId.get(
          element.pcb_trace_id,
        )
        return solverTraceId
          ? { ...element, pcb_trace_id: solverTraceId }
          : element
      })
      return {
        errors: normalizePipeline9DrcErrorsForRepair({
          errors: remapDrcTraceIds(
            evaluatedDrc.errors as unknown as Array<Record<string, unknown>>,
            solverTraceIdByEvaluationTraceId,
          ),
          circuitJson: remappedCircuitJson,
          newTraceIds: movableTraceIds,
        }),
        errorsWithCenters: normalizePipeline9DrcErrorsForRepair({
          errors: remapDrcTraceIds(
            evaluatedDrc.errorsWithCenters as unknown as Array<
              Record<string, unknown>
            >,
            solverTraceIdByEvaluationTraceId,
          ),
          circuitJson: remappedCircuitJson,
          newTraceIds: movableTraceIds,
        }),
      }
    }
    this.drcEvaluator = drcEvaluator

    this.exactRepairSolver = new GlobalDrcBranchPortfolioSolver({
      srj: extendedSrjWithPointPairs as any,
      hdRoutes: [
        ...params.newHdRoutes,
        ...this.movablePreloadedTraces.map(
          (movableTrace) => movableTrace.hdRoute,
        ),
      ],
      connMap: params.connMap,
      effort: params.effort,
      viaHoleDiameter: params.defaultViaHoleDiameter,
      drcEvaluator,
      viaInPadDrcEvaluator: drcEvaluator,
      maxIterations: 64,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: true,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: true,
      viaInPadMaxIterations: 64,
      broadMaxIterations: 16,
      broadPassMultiplier: 3,
    })
    this.activeSubSolver = this.exactRepairSolver
    this.MAX_ITERATIONS = this.exactRepairSolver.MAX_ITERATIONS + 1
  }

  override getSolverName(): string {
    return "Pipeline9JointDrcRepairSolver"
  }

  override _step(): void {
    if (!this.exactRepairSolver) {
      this.solved = true
      return
    }
    this.exactRepairSolver.step()
    this.progress = this.exactRepairSolver.progress
    if (this.exactRepairSolver.failed) {
      this.failed = true
      this.error = this.exactRepairSolver.error
      return
    }
    if (!this.exactRepairSolver.solved) return
    const terminalEscapeResult = applyPipeline9TerminalEscapeRelocations({
      srj: this.params.srj,
      routes: this.exactRepairSolver.getOutput(),
      newConnections: this.params.newConnections,
      syntheticConnectionNames: this.syntheticConnectionNames,
      drcEvaluator: this.drcEvaluator!,
    })
    const regionalB01RepairResult = applyPipeline9RegionalB01Repairs({
      srj: this.params.srj,
      routes: terminalEscapeResult.routes,
      fixedObstacleRoutes: this.fixedPreloadedObstacleRoutes,
      newConnections: this.params.newConnections,
      syntheticConnectionNames: this.syntheticConnectionNames,
      drcEvaluator: this.drcEvaluator!,
      connMap: this.params.connMap,
      colorMap: this.params.colorMap,
      viaDiameter: this.params.defaultViaDiameter,
      traceWidth: this.params.srj.minTraceWidth,
      obstacleMargin:
        this.params.srj.defaultObstacleMargin ??
        this.params.srj.minTraceToPadEdgeClearance ??
        0.15,
      effort: this.params.effort,
    })
    this.combinedOutput = regionalB01RepairResult.routes
    this.stats = {
      ...this.stats,
      ...this.exactRepairSolver.stats,
      regionalB01RepairCandidateCount:
        regionalB01RepairResult.attemptedCandidateCount,
      regionalB01RepairAcceptedCount:
        regionalB01RepairResult.acceptedCandidateCount,
      regionalB01RepairFallbackCandidateCount:
        regionalB01RepairResult.fallbackCandidateCount,
      terminalEscapeCandidateCount:
        terminalEscapeResult.attemptedCandidateCount,
      terminalEscapeAcceptedCount: terminalEscapeResult.acceptedCandidateCount,
    }
    this.solved = true
  }

  private getCombinedOutput(): HighDensityRoute[] {
    return (
      this.combinedOutput ??
      this.exactRepairSolver?.getOutput() ??
      this.inputNewHdRoutes
    )
  }

  getOutput(): HighDensityRoute[] {
    return this.getCombinedOutput().filter(
      (route) => !this.syntheticConnectionNames.has(route.connectionName),
    )
  }

  getUpdatedPreloadedTraces(): SimplifiedPcbTrace[] {
    const outputRouteByConnectionName = new Map(
      this.getCombinedOutput().map((route) => [route.connectionName, route]),
    )
    const repairedTraceById = new Map(
      this.movablePreloadedTraces.map((movableTrace) => {
        const outputRoute = outputRouteByConnectionName.get(
          movableTrace.syntheticConnectionName,
        )
        if (!outputRoute) {
          throw new Error(
            `Pipeline9 joint DRC repair output is missing "${movableTrace.syntheticConnectionName}"`,
          )
        }
        return [
          movableTrace.originalTrace.pcb_trace_id,
          {
            ...movableTrace.originalTrace,
            __replaces_pcb_trace_id: movableTrace.originalTrace.pcb_trace_id,
            route: convertHdRouteToSimplifiedRoute(
              outputRoute,
              this.params.layerCount,
              {
                defaultViaHoleDiameter: this.params.defaultViaHoleDiameter,
                obstacles: this.params.obstacles,
                connMap: this.params.connMap,
              },
            ),
          },
        ] as const
      }),
    )
    return this.inputUpdatedPreloadedTraces.map(
      (trace) => repairedTraceById.get(trace.pcb_trace_id) ?? trace,
    )
  }

  getMutatedPreloadedTraces(): SimplifiedPcbTrace[] {
    const mutatedTraceIds = new Set([
      ...this.params.mutatedPreloadedTraceIds,
      ...this.movablePreloadedTraces.map(
        (movableTrace) => movableTrace.originalTrace.pcb_trace_id,
      ),
    ])
    return this.getUpdatedPreloadedTraces().filter((trace) =>
      mutatedTraceIds.has(trace.pcb_trace_id),
    )
  }

  override visualize(): GraphicsObject {
    return this.exactRepairSolver?.visualize() ?? {}
  }
}
