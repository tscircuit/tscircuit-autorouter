import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import {
  AutoroutingDrcEngine,
  type DrcEvaluator,
  type SimpleRouteJson as RepairSimpleRouteJson,
  type SimplifiedPcbTraces as RepairSimplifiedPcbTraces,
} from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import {
  combinePreloadedAndRoutedTraces,
  evaluateRelaxedDrc,
} from "lib/testing/evaluate-relaxed-drc"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { Pipeline7AdaptiveDrcBranchPortfolioSolver } from "../AutoroutingPipeline7_MultiGraph/Pipeline7AdaptiveDrcBranchPortfolioSolver"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "../AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { applyPipeline9RegionalB01Repairs } from "./applyPipeline9RegionalB01Repairs"
import { applyPipeline9TerminalEscapeRelocations } from "./applyPipeline9TerminalEscapeRelocations"
import { assignUniquePcbTraceIdsToNewTraces } from "./assignUniquePcbTraceIdsToNewTraces"
import {
  type PreloadedHighDensityRoute,
  convertPreloadedTraceToHdRoutes,
} from "./convertPreloadedTraceToHdRoutes"
import { filterPipeline9DrcErrorsAgainstBaseline } from "./filterPipeline9DrcErrorsAgainstBaseline"
import { getPipeline9PreloadedTraceIdsInInitialDrcRegions } from "./getPipeline9PreloadedTraceIdsInInitialDrcRegions"
import { getPipeline9PreloadedViaPairTraceGroups } from "./getPipeline9PreloadedViaPairTraceGroups"
import { mergePipeline9MovablePreloadedVias } from "./mergePipeline9MovablePreloadedVias"
import { normalizePipeline9DrcErrorsForRepair } from "./normalizePipeline9DrcErrorsForRepair"
import {
  getPipeline9DrcErrors,
  getPipeline9RouteIndexByTraceId,
  type Pipeline9CollapsedTraceParticipant,
  type Pipeline9PreloadRepairTraceIds,
} from "./pipeline9JointDrcRepairUtils"
import { preparePipeline9DrcRoutedTracesWithMetadata } from "./preparePipeline9DrcRoutedTraces"

const EXACT_REPAIR_MAX_ITERATIONS = 32
const EXACT_REPAIR_BROAD_MAX_ITERATIONS = 12
// Reference validation and terminal relocation are precision passes for small
// residual sets. Keep that exhaustive search for compact residues while
// bounding terminal relocation's repeated whole-board indexed DRC scans.
const MAX_POST_EXACT_PRECISION_PASS_INDEXED_ISSUE_COUNT = 16
const INDEXED_DRC_CANDIDATE_CACHE_SIZE = 64

type DrcCandidateKey = string & { readonly __brand: "DrcCandidateKey" }

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

type MovablePreloadedSection = {
  originalTrace: SimplifiedPcbTrace
  originalRoutePositionStart: number
  originalRoutePositionEnd: number
  syntheticConnectionName: string
  evaluationTraceId: string
  hdRoute: HighDensityRoute
}

type PreloadedTraceSectionGroup = {
  routePositionStart: number
  routePositionEnd: number
  routes: PreloadedHighDensityRoute[]
}

type PreparedCandidateDrcInput = {
  evaluatedTraces: SimplifiedPcbTrace[]
  movableTraceIds: ReadonlySet<string>
  originalTraceIdByEvaluationTraceId: ReadonlyMap<string, string>
  routedTraces: SimplifiedPcbTrace[]
  solverTraceIdByEvaluationTraceId: ReadonlyMap<string, string>
}

type NormalizedCandidateDrcResult = {
  errors: Array<Record<string, unknown>>
  errorsWithCenters: Array<Record<string, unknown>>
}

const POINT_EPSILON = 1e-9

const getAutoroutingViaElements = (
  traces: readonly SimplifiedPcbTrace[],
): AnyCircuitElement[] => {
  const viaLocations = new Set<string>()
  const vias: AnyCircuitElement[] = []
  for (const trace of traces) {
    for (const routePoint of trace.route) {
      if (routePoint.route_type !== "via") continue
      const locationKey = `${routePoint.x},${routePoint.y},${routePoint.from_layer},${routePoint.to_layer}`
      if (viaLocations.has(locationKey)) continue
      viaLocations.add(locationKey)
      vias.push({
        type: "pcb_via",
        pcb_via_id: `via_${vias.length}`,
        pcb_trace_id: trace.pcb_trace_id,
      } as AnyCircuitElement)
    }
  }
  return vias
}

export const addAutoroutingViaTraceIds = ({
  errors,
  circuitJson,
  evaluatedTraceIds,
}: {
  errors: Array<Record<string, unknown>>
  circuitJson: AnyCircuitElement[]
  evaluatedTraceIds: ReadonlySet<string>
}): Array<Record<string, unknown>> => {
  const traceIdByViaId = new Map(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via" &&
      typeof element.pcb_via_id === "string" &&
      typeof element.pcb_trace_id === "string"
        ? [[element.pcb_via_id, element.pcb_trace_id] as const]
        : [],
    ),
  )
  return errors.map((error) => {
    const explicitViaIds = [
      ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
      ...(Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.filter(
            (viaId): viaId is string => typeof viaId === "string",
          )
        : []),
    ]
    const primaryTraceId =
      typeof error.pcb_trace_id === "string" ? error.pcb_trace_id : undefined
    const pairPrefix = primaryTraceId ? `overlap_${primaryTraceId}_` : undefined
    const encodedPairTraceId =
      pairPrefix &&
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(pairPrefix)
        ? error.pcb_trace_error_id.slice(pairPrefix.length)
        : undefined
    const encodedViaIdCandidate =
      typeof error.pcb_trace_error_id === "string"
        ? error.pcb_trace_error_id.match(/_(via_\d+)$/)?.[1]
        : undefined
    const encodedViaId =
      explicitViaIds.length === 0 &&
      encodedViaIdCandidate &&
      traceIdByViaId.has(encodedViaIdCandidate) &&
      !(encodedPairTraceId && evaluatedTraceIds.has(encodedPairTraceId))
        ? encodedViaIdCandidate
        : undefined
    const viaIds = [
      ...explicitViaIds,
      ...(encodedViaId ? [encodedViaId] : []),
    ].filter(
      (viaId, viaIndex, allViaIds) => allViaIds.indexOf(viaId) === viaIndex,
    )
    const traceIds = [
      ...(typeof error.pcb_trace_id === "string" ? [error.pcb_trace_id] : []),
      ...(Array.isArray(error.pcb_trace_ids)
        ? error.pcb_trace_ids.filter(
            (traceId): traceId is string => typeof traceId === "string",
          )
        : []),
      ...viaIds.flatMap((viaId) => {
        const traceId = traceIdByViaId.get(viaId)
        return traceId ? [traceId] : []
      }),
    ].filter(
      (traceId, traceIndex, allTraceIds) =>
        allTraceIds.indexOf(traceId) === traceIndex,
    )
    return {
      ...error,
      ...(viaIds.length > 0
        ? { pcb_via_id: viaIds[0], pcb_via_ids: viaIds }
        : {}),
      ...(viaIds.length > 0 && traceIds.length > 0
        ? { pcb_trace_ids: traceIds }
        : {}),
    }
  })
}

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

const combinePreloadedTraceSectionGroup = ({
  trace,
  sectionGroup,
  syntheticConnectionName,
  connMap,
}: {
  trace: SimplifiedPcbTrace
  sectionGroup: PreloadedTraceSectionGroup
  syntheticConnectionName: string
  connMap: ConnectivityMap
}): HighDensityRoute => {
  const traceSections = sectionGroup.routes
  if (traceSections.length === 0) {
    throw new Error(
      `Pipeline9 cannot exactly repair empty preloaded section for trace "${trace.pcb_trace_id}"`,
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

  const startsAtTraceTerminal = sectionGroup.routePositionStart === 0
  const endsAtTraceTerminal =
    sectionGroup.routePositionEnd === trace.route.length - 1
  const startPcbPortId = startsAtTraceTerminal ? trace.connectsTo?.[0] : null
  const endPcbPortId = endsAtTraceTerminal ? trace.connectsTo?.at(-1) : null
  if (startPcbPortId && route[0]) {
    route[0] = { ...route[0], pcb_port_id: startPcbPortId }
  }
  if (endPcbPortId && route.at(-1)) {
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

const getPreloadedTraceSectionGroups = ({
  trace,
  traceIndex,
  layerCount,
  defaultViaDiameter,
  connMap,
}: {
  trace: SimplifiedPcbTrace
  traceIndex: number
  layerCount: number
  defaultViaDiameter: number
  connMap: ConnectivityMap
}): PreloadedTraceSectionGroup[] => {
  const throughObstaclePositions = trace.route.flatMap(
    (routePoint, routePosition) =>
      routePoint.route_type === "through_obstacle" ? [routePosition] : [],
  )
  const sectionGroups = new Map<number, PreloadedTraceSectionGroup>()
  const primitiveRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    traceIndex,
    layerCount,
    defaultViaDiameter,
    connMap,
  )

  for (const primitiveRoute of primitiveRoutes) {
    const routePositionStart = primitiveRoute.preloadedRoutePositionStart
    const routePositionEnd = primitiveRoute.preloadedRoutePositionEnd
    if (routePositionStart === undefined || routePositionEnd === undefined) {
      throw new Error(
        `Pipeline9 preloaded trace section is missing route positions for "${trace.pcb_trace_id}"`,
      )
    }
    if (trace.route[routePositionStart]?.route_type === "through_obstacle") {
      continue
    }
    const sectionIndex = throughObstaclePositions.filter(
      (routePosition) => routePosition < routePositionStart,
    ).length
    const sectionGroup = sectionGroups.get(sectionIndex) ?? {
      routePositionStart,
      routePositionEnd,
      routes: [],
    }
    sectionGroup.routePositionStart = Math.min(
      sectionGroup.routePositionStart,
      routePositionStart,
    )
    sectionGroup.routePositionEnd = Math.max(
      sectionGroup.routePositionEnd,
      routePositionEnd,
    )
    sectionGroup.routes.push(primitiveRoute)
    sectionGroups.set(sectionIndex, sectionGroup)
  }

  return [...sectionGroups.values()]
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
    const explicitViaIds = [
      ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
      ...(Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.filter(
            (viaId): viaId is string => typeof viaId === "string",
          )
        : []),
    ]
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
      const encodedOtherTraceId = error.pcb_trace_error_id.slice(
        pairPrefix.length,
      )
      if (!explicitViaIds.includes(encodedOtherTraceId)) {
        traceIds.add(encodedOtherTraceId)
      }
    }
  }
  return traceIds
}

export const remapDrcTraceIds = (
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
    const explicitViaIds = [
      ...(typeof error.pcb_via_id === "string" ? [error.pcb_via_id] : []),
      ...(Array.isArray(error.pcb_via_ids)
        ? error.pcb_via_ids.filter(
            (viaId): viaId is string => typeof viaId === "string",
          )
        : []),
    ]
    const encodedIdentityIsVia =
      encodedOtherEvaluationTraceId !== undefined &&
      explicitViaIds.includes(encodedOtherEvaluationTraceId)
    const evaluationTraceIds = [
      primaryEvaluationTraceId,
      ...explicitEvaluationTraceIds,
      encodedIdentityIsVia ? undefined : encodedOtherEvaluationTraceId,
    ].filter((traceId): traceId is string => typeof traceId === "string")
    const evaluationTraceIdsBySolverTraceId = new Map<string, Set<string>>()
    for (const evaluationTraceId of evaluationTraceIds) {
      const solverTraceId =
        solverTraceIdByEvaluationTraceId.get(evaluationTraceId) ??
        evaluationTraceId
      const collapsedEvaluationTraceIds =
        evaluationTraceIdsBySolverTraceId.get(solverTraceId) ??
        new Set<string>()
      collapsedEvaluationTraceIds.add(evaluationTraceId)
      evaluationTraceIdsBySolverTraceId.set(
        solverTraceId,
        collapsedEvaluationTraceIds,
      )
    }
    const collapsedTraceParticipants: Pipeline9CollapsedTraceParticipant[] = [
      ...evaluationTraceIdsBySolverTraceId,
    ].flatMap(([solverTraceId, collapsedEvaluationTraceIds]) =>
      collapsedEvaluationTraceIds.size > 1
        ? [
            {
              solverTraceId,
              evaluationTraceIds: [...collapsedEvaluationTraceIds],
            },
          ]
        : [],
    )
    const primarySolverTraceId = primaryEvaluationTraceId
      ? (solverTraceIdByEvaluationTraceId.get(primaryEvaluationTraceId) ??
        primaryEvaluationTraceId)
      : undefined
    const explicitSolverTraceIds = explicitEvaluationTraceIds.map(
      (traceId) => solverTraceIdByEvaluationTraceId.get(traceId) ?? traceId,
    )
    const encodedOtherSolverTraceId = encodedOtherEvaluationTraceId
      ? encodedIdentityIsVia
        ? encodedOtherEvaluationTraceId
        : (solverTraceIdByEvaluationTraceId.get(
            encodedOtherEvaluationTraceId,
          ) ?? encodedOtherEvaluationTraceId)
      : undefined
    const remappingChangesIdentity =
      primarySolverTraceId !== primaryEvaluationTraceId ||
      explicitSolverTraceIds.some(
        (traceId, traceIndex) =>
          traceId !== explicitEvaluationTraceIds[traceIndex],
      ) ||
      encodedOtherSolverTraceId !== encodedOtherEvaluationTraceId
    if (!remappingChangesIdentity) return error

    return {
      ...error,
      ...(primaryEvaluationTraceId
        ? { pcb_trace_id: primarySolverTraceId }
        : {}),
      ...(Array.isArray(error.pcb_trace_ids)
        ? { pcb_trace_ids: explicitSolverTraceIds }
        : {}),
      ...(primarySolverTraceId && encodedOtherSolverTraceId
        ? {
            pcb_trace_error_id: `overlap_${primarySolverTraceId}_${encodedOtherSolverTraceId}`,
          }
        : {}),
      ...(collapsedTraceParticipants.length > 0
        ? { __collapsed_trace_participants: collapsedTraceParticipants }
        : {}),
    }
  })

const createSyntheticConnection = (
  movableSection: MovablePreloadedSection,
  layerCount: number,
): SimpleRouteConnection => {
  const start = movableSection.hdRoute.route[0]!
  const end = movableSection.hdRoute.route.at(-1)!
  return {
    name: movableSection.syntheticConnectionName,
    rootConnectionName: movableSection.hdRoute.rootConnectionName,
    __netConnectionName: movableSection.originalTrace.connection_name,
    nominalTraceWidth: movableSection.hdRoute.traceThickness,
    pointsToConnect: [
      {
        x: start.x,
        y: start.y,
        layer: mapZToLayerName(start.z, layerCount),
        pointId: `${movableSection.syntheticConnectionName}:start`,
      },
      {
        x: end.x,
        y: end.y,
        layer: mapZToLayerName(end.z, layerCount),
        pointId: `${movableSection.syntheticConnectionName}:end`,
      },
    ],
  }
}

const rebuildPreloadedTraceFromSections = ({
  originalTrace,
  repairedSections,
}: {
  originalTrace: SimplifiedPcbTrace
  repairedSections: Array<{
    routePositionStart: number
    routePositionEnd: number
    route: SimplifiedPcbTrace["route"]
  }>
}): SimplifiedPcbTrace => {
  const rebuiltRoute: SimplifiedPcbTrace["route"] = []
  let originalRoutePosition = 0
  for (const repairedSection of [...repairedSections].sort(
    (left, right) => left.routePositionStart - right.routePositionStart,
  )) {
    if (repairedSection.routePositionStart < originalRoutePosition) {
      throw new Error(
        `Pipeline9 found overlapping repaired sections for preloaded trace "${originalTrace.pcb_trace_id}"`,
      )
    }
    rebuiltRoute.push(
      ...originalTrace.route.slice(
        originalRoutePosition,
        repairedSection.routePositionStart,
      ),
      ...repairedSection.route,
    )
    originalRoutePosition = repairedSection.routePositionEnd + 1
  }
  rebuiltRoute.push(...originalTrace.route.slice(originalRoutePosition))

  return {
    ...originalTrace,
    __replaces_pcb_trace_id: originalTrace.pcb_trace_id,
    route: rebuiltRoute,
  }
}

export const getPipeline9PreloadRepairTraceIds = ({
  routes,
  newConnections,
  syntheticConnectionNames,
  fixedPreloadedObstacleRoutes,
  updatedPreloadedTraces,
}: {
  routes: HighDensityRoute[]
  newConnections: SimpleRouteConnection[]
  syntheticConnectionNames: ReadonlySet<string>
  fixedPreloadedObstacleRoutes: PreloadedHighDensityRoute[]
  updatedPreloadedTraces: SimplifiedPcbTrace[]
}): Pipeline9PreloadRepairTraceIds => {
  const collidingFixedTraceIds = new Set<string>()
  const preloadRepairTraceIds = Object.assign(new Set<string>(), {
    collidingFixedTraceIds,
  })
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({
    routes,
    newConnections,
    syntheticConnectionNames,
  })
  const newRouteTraceIds = new Set<string>()
  for (const [traceId, routeIndex] of routeIndexByTraceId) {
    if (syntheticConnectionNames.has(routes[routeIndex]!.connectionName)) {
      preloadRepairTraceIds.add(traceId)
    } else {
      newRouteTraceIds.add(traceId)
    }
  }
  for (const fixedRoute of fixedPreloadedObstacleRoutes) {
    const originalTrace = updatedPreloadedTraces[fixedRoute.preloadedTraceIndex]
    if (!originalTrace) {
      throw new Error(
        `Pipeline9 fixed preload route has invalid trace index ${fixedRoute.preloadedTraceIndex}`,
      )
    }
    if (newRouteTraceIds.has(originalTrace.pcb_trace_id)) {
      collidingFixedTraceIds.add(originalTrace.pcb_trace_id)
    } else {
      preloadRepairTraceIds.add(originalTrace.pcb_trace_id)
    }
  }
  return preloadRepairTraceIds
}

/**
 * Gives the existing exact DRC portfolio ownership of only the preloaded
 * traces that participate in a remaining joint-output DRC error.
 */
export class Pipeline9JointDrcRepairSolver extends BaseSolver {
  readonly params: Pipeline9JointDrcRepairSolverParams
  readonly inputNewHdRoutes: HighDensityRoute[]
  readonly inputUpdatedPreloadedTraces: SimplifiedPcbTrace[]
  readonly movablePreloadedSections: MovablePreloadedSection[]
  readonly fixedPreloadedObstacleRoutes: PreloadedHighDensityRoute[]
  readonly syntheticConnectionNames: ReadonlySet<string>
  readonly exactRepairSolver?: Pipeline7AdaptiveDrcBranchPortfolioSolver
  private drcEvaluator?: DrcEvaluator
  private cachedReferenceDrcEvaluator?: DrcEvaluator
  private referenceDrcValidationCount = 0
  private referenceDrcFalseNegativeCount = 0
  private indexedDrcEvaluationCount = 0
  private indexedDrcCacheHitCount = 0
  private indexedDrcEvaluationTimeMs = 0
  private readonly indexedDrcCandidateCache = new Map<
    DrcCandidateKey,
    ReturnType<DrcEvaluator>
  >()
  private combinedOutput?: HighDensityRoute[]

  private cacheIndexedDrcResult(
    candidateKey: DrcCandidateKey,
    result: ReturnType<DrcEvaluator>,
  ): void {
    if (
      this.indexedDrcCandidateCache.size >= INDEXED_DRC_CANDIDATE_CACHE_SIZE
    ) {
      const oldestCandidateKey = this.indexedDrcCandidateCache
        .keys()
        .next().value
      if (oldestCandidateKey !== undefined) {
        this.indexedDrcCandidateCache.delete(oldestCandidateKey)
      }
    }
    this.indexedDrcCandidateCache.set(candidateKey, result)
  }

  constructor(params: Pipeline9JointDrcRepairSolverParams) {
    super()
    this.params = params
    this.inputNewHdRoutes = params.newHdRoutes
    this.inputUpdatedPreloadedTraces = params.updatedPreloadedTraces

    const currentMutatedPreloadedTraces = params.updatedPreloadedTraces.filter(
      (trace) => params.mutatedPreloadedTraceIds.has(trace.pcb_trace_id),
    )
    // Repair candidates change copper geometry, but their connection metadata
    // and obstacle connectivity remain fixed throughout this solver's lifetime.
    const convertNewRoutes =
      createPipeline7HdRoutesToSimplifiedPcbTracesConverter({
        connections: params.newConnections,
        originalConnections: params.originalSrj.connections,
        layerCount: params.layerCount,
        obstacles: params.obstacles,
        defaultViaHoleDiameter: params.defaultViaHoleDiameter,
        connMap: params.connMap,
      })
    const currentNewTraces = convertNewRoutes(params.newHdRoutes)
    const currentNewTraceIds = new Set(
      currentNewTraces.map((trace) => trace.pcb_trace_id),
    )
    const preparedCurrentOutput = preparePipeline9DrcRoutedTracesWithMetadata({
      originalPreloadedTraces: params.originalSrj.traces ?? [],
      mutatedPreloadedTraces: currentMutatedPreloadedTraces,
      newTraces: currentNewTraces,
    })
    const traceClearance =
      params.originalSrj.minTraceToPadEdgeClearance ??
      RELAXED_DRC_OPTIONS.traceClearance ??
      0.1
    const viaClearance = RELAXED_DRC_OPTIONS.viaClearance ?? 0.1
    const baselineDrc = evaluateRelaxedDrc({
      inputSrj: params.originalSrj,
      srjWithPointPairs: params.srjWithPointPairs,
      routedTraces: [],
      drcOptions: { traceClearance },
    })
    const baselineEvaluatedTraceIds = new Set(
      (params.originalSrj.traces ?? []).map((trace) => trace.pcb_trace_id),
    )
    const baselineErrors = addAutoroutingViaTraceIds({
      errors: baselineDrc.errors as unknown as Array<Record<string, unknown>>,
      circuitJson: baselineDrc.circuitJson,
      evaluatedTraceIds: baselineEvaluatedTraceIds,
    })
    const baselineErrorsWithCenters = addAutoroutingViaTraceIds({
      errors: baselineDrc.errorsWithCenters as unknown as Array<
        Record<string, unknown>
      >,
      circuitJson: baselineDrc.circuitJson,
      evaluatedTraceIds: baselineEvaluatedTraceIds,
    })
    const currentDrcResult = evaluateRelaxedDrc({
      inputSrj: params.originalSrj,
      srjWithPointPairs: params.srjWithPointPairs,
      routedTraces: preparedCurrentOutput.routedTraces,
      drcOptions: { traceClearance },
    })
    const currentEvaluatedTraceIds = new Set(
      combinePreloadedAndRoutedTraces(
        params.originalSrj.traces ?? [],
        preparedCurrentOutput.routedTraces,
      ).map((trace) => trace.pcb_trace_id),
    )
    const currentErrors = addAutoroutingViaTraceIds({
      errors: currentDrcResult.errors as unknown as Array<
        Record<string, unknown>
      >,
      circuitJson: currentDrcResult.circuitJson,
      evaluatedTraceIds: currentEvaluatedTraceIds,
    })
    const currentErrorsWithCenters = addAutoroutingViaTraceIds({
      errors: currentDrcResult.errorsWithCenters as unknown as Array<
        Record<string, unknown>
      >,
      circuitJson: currentDrcResult.circuitJson,
      evaluatedTraceIds: currentEvaluatedTraceIds,
    })
    const currentDrc = {
      ...currentDrcResult,
      errors: filterPipeline9DrcErrorsAgainstBaseline({
        errors: currentErrors,
        baselineErrors,
        originalTraceIdByPreparedTraceId:
          preparedCurrentOutput.originalPreloadedTraceIdByPreparedTraceId,
      }),
      errorsWithCenters: filterPipeline9DrcErrorsAgainstBaseline({
        errors: currentErrorsWithCenters,
        baselineErrors: baselineErrorsWithCenters,
        originalTraceIdByPreparedTraceId:
          preparedCurrentOutput.originalPreloadedTraceIdByPreparedTraceId,
      }),
    }
    const preparedTraceIdsInErrors = getTraceIdsFromDrcErrors({
      errors: currentDrc.errors as unknown as Array<Record<string, unknown>>,
      circuitJson: currentDrc.circuitJson,
    })
    const updatedPreloadedTraceById = new Map(
      params.updatedPreloadedTraces.map((trace) => [trace.pcb_trace_id, trace]),
    )
    const candidateMovablePreloadedTraceIds = new Set<string>()
    for (const preparedTraceId of preparedTraceIdsInErrors) {
      const explicitOriginalPreloadedTraceId =
        preparedCurrentOutput.originalPreloadedTraceIdByPreparedTraceId.get(
          preparedTraceId,
        )
      if (
        explicitOriginalPreloadedTraceId &&
        updatedPreloadedTraceById.has(explicitOriginalPreloadedTraceId)
      ) {
        candidateMovablePreloadedTraceIds.add(explicitOriginalPreloadedTraceId)
        continue
      }
      if (
        !currentNewTraceIds.has(preparedTraceId) &&
        updatedPreloadedTraceById.has(preparedTraceId)
      ) {
        candidateMovablePreloadedTraceIds.add(preparedTraceId)
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
      candidateMovablePreloadedTraceIds.add(traceId)
    }

    // Through-obstacle connectivity belongs to the connected component
    // obstacle. Keep that primitive fixed and give exact repair ownership of
    // the ordinary copper sections anchored on either side of it.
    this.movablePreloadedSections = []
    for (const traceId of candidateMovablePreloadedTraceIds) {
      const trace = updatedPreloadedTraceById.get(traceId)
      if (!trace) {
        throw new Error(
          `Pipeline9 cannot find preloaded trace "${traceId}" selected for exact repair`,
        )
      }
      const traceIndex = params.updatedPreloadedTraces.findIndex(
        (updatedTrace) => updatedTrace.pcb_trace_id === traceId,
      )
      const sectionGroups = getPreloadedTraceSectionGroups({
        trace,
        traceIndex,
        layerCount: params.layerCount,
        defaultViaDiameter: params.defaultViaDiameter,
        connMap: params.connMap,
      })
      for (const [traceSectionIndex, sectionGroup] of sectionGroups.entries()) {
        const movableSectionIndex = this.movablePreloadedSections.length
        const syntheticConnectionName = `pipeline9_preloaded_drc_${movableSectionIndex}`
        this.movablePreloadedSections.push({
          originalTrace: trace,
          originalRoutePositionStart: sectionGroup.routePositionStart,
          originalRoutePositionEnd: sectionGroup.routePositionEnd,
          syntheticConnectionName,
          evaluationTraceId: `${trace.pcb_trace_id}__pipeline9_section_${traceSectionIndex}`,
          hdRoute: combinePreloadedTraceSectionGroup({
            trace,
            sectionGroup,
            syntheticConnectionName,
            connMap: params.connMap,
          }),
        })
      }
    }
    this.syntheticConnectionNames = new Set(
      this.movablePreloadedSections.map(
        (movableSection) => movableSection.syntheticConnectionName,
      ),
    )
    const movablePreloadedTraceIds = new Set(
      this.movablePreloadedSections.map(
        (movableSection) => movableSection.originalTrace.pcb_trace_id,
      ),
    )
    this.fixedPreloadedObstacleRoutes = params.updatedPreloadedTraces.flatMap(
      (trace, traceIndex) => {
        const fixedRoutes = convertPreloadedTraceToHdRoutes(
          trace,
          traceIndex,
          params.layerCount,
          params.defaultViaDiameter,
          params.connMap,
        )
        if (!movablePreloadedTraceIds.has(trace.pcb_trace_id)) {
          return fixedRoutes
        }
        return fixedRoutes.filter((route) => {
          const routePosition = route.preloadedRoutePositionStart
          return (
            routePosition !== undefined &&
            trace.route[routePosition]?.route_type === "through_obstacle"
          )
        })
      },
    )
    const movableSectionIndexesByOriginalTraceId = new Map<string, number[]>()
    for (const [
      movableSectionIndex,
      movableSection,
    ] of this.movablePreloadedSections.entries()) {
      const originalTraceId = movableSection.originalTrace.pcb_trace_id
      const sectionIndexes =
        movableSectionIndexesByOriginalTraceId.get(originalTraceId) ?? []
      sectionIndexes.push(movableSectionIndex)
      movableSectionIndexesByOriginalTraceId.set(
        originalTraceId,
        sectionIndexes,
      )
    }
    for (const originalTraceIds of getPipeline9PreloadedViaPairTraceGroups({
      errors: currentDrc.errors as unknown as Array<Record<string, unknown>>,
      circuitJson: currentDrc.circuitJson,
      originalTraceIdByPreparedTraceId:
        preparedCurrentOutput.originalPreloadedTraceIdByPreparedTraceId,
    })) {
      const movableSectionIndexes = originalTraceIds
        .flatMap(
          (traceId) =>
            movableSectionIndexesByOriginalTraceId.get(traceId) ?? [],
        )
        .filter(
          (sectionIndex, index, sectionIndexes) =>
            sectionIndexes.indexOf(sectionIndex) === index,
        )
      if (movableSectionIndexes.length === 0) continue
      const movableSectionIndexSet = new Set(movableSectionIndexes)
      const mergedRoutes = mergePipeline9MovablePreloadedVias({
        routes: movableSectionIndexes.map(
          (movableSectionIndex) =>
            this.movablePreloadedSections[movableSectionIndex]!.hdRoute,
        ),
        otherHdRoutes: [
          ...params.newHdRoutes,
          ...this.fixedPreloadedObstacleRoutes,
          ...this.movablePreloadedSections.flatMap(
            (movableSection, movableSectionIndex) =>
              movableSectionIndexSet.has(movableSectionIndex)
                ? []
                : [movableSection.hdRoute],
          ),
        ],
        obstacles: params.obstacles,
        colorMap: params.colorMap,
        layerCount: params.layerCount,
        connMap: params.connMap,
      })
      for (
        let groupIndex = 0;
        groupIndex < movableSectionIndexes.length;
        groupIndex++
      ) {
        this.movablePreloadedSections[
          movableSectionIndexes[groupIndex]!
        ]!.hdRoute = mergedRoutes[groupIndex]!
      }
    }
    this.stats = {
      initialJointDrcIssueCount: currentDrc.errors.length,
      baselineJointDrcIssueCount: baselineDrc.errors.length,
      initialJointDrcIssueCountByType: currentDrc.errors.reduce<
        Record<string, number>
      >((counts, error) => {
        const errorType = String(error.type ?? error.error_type ?? "unknown")
        counts[errorType] = (counts[errorType] ?? 0) + 1
        return counts
      }, {}),
      movablePreloadedTraceCount: movablePreloadedTraceIds.size,
      movablePreloadedSectionCount: this.movablePreloadedSections.length,
      exactRepairConfiguredMaxIterations: EXACT_REPAIR_MAX_ITERATIONS,
      exactRepairConfiguredViaInPadMaxIterations: EXACT_REPAIR_MAX_ITERATIONS,
      exactRepairConfiguredBroadMaxIterations:
        EXACT_REPAIR_BROAD_MAX_ITERATIONS,
    }

    if (currentDrc.errors.length === 0) {
      this.solved = true
      return
    }

    const movableOriginalTraceIds = new Set(
      this.movablePreloadedSections.map(
        (movableSection) => movableSection.originalTrace.pcb_trace_id,
      ),
    )
    const nonMovableMutatedPreloadedTraces =
      currentMutatedPreloadedTraces.filter(
        (trace) => !movableOriginalTraceIds.has(trace.pcb_trace_id),
      )
    const syntheticConnectionByName = new Map(
      this.movablePreloadedSections.map((movableSection) => [
        movableSection.syntheticConnectionName,
        createSyntheticConnection(movableSection, params.layerCount),
      ]),
    )
    // Preloaded copper is represented by fixed and synthetic HD routes in the
    // joint evaluator. Keeping it in the branch solver SRJ as well changes the
    // portfolio search state and double-counts the same geometry.
    const { traces: _preloadedTraces, ...srjWithoutPreloadedTraceObstacles } =
      params.srjWithPointPairs
    const extendedSrjWithPointPairs: SimpleRouteJson = {
      ...srjWithoutPreloadedTraceObstacles,
      // Both candidate construction and exact DRC need the original pad
      // shapes; routing approximations discard rotation and enlarge pads.
      obstacles: params.originalSrj.obstacles,
      connections: [
        ...params.srjWithPointPairs.connections,
        ...syntheticConnectionByName.values(),
      ],
    }
    const autoroutingDrcEngine = new AutoroutingDrcEngine(
      {
        ...extendedSrjWithPointPairs,
        minTraceWidth: params.originalSrj.minTraceWidth,
        minViaDiameter:
          params.originalSrj.minViaDiameter ?? params.defaultViaDiameter,
      } as RepairSimpleRouteJson,
      {
        connMap: params.connMap,
        traceClearance,
        viaClearance,
        includeTraceViaOwnerMetadata: true,
        spatialCellSize:
          Math.max(
            params.defaultViaDiameter,
            params.originalSrj.minTraceWidth,
          ) + Math.max(traceClearance, viaClearance),
      },
    )
    const autoroutingBaselineDrcResult = autoroutingDrcEngine.evaluate(
      (params.originalSrj.traces ?? []) as RepairSimplifiedPcbTraces,
    )
    const autoroutingBaselineViaCircuitJson = getAutoroutingViaElements(
      params.originalSrj.traces ?? [],
    )
    const autoroutingBaselineDrc = {
      ...autoroutingBaselineDrcResult,
      errors: addAutoroutingViaTraceIds({
        errors: autoroutingBaselineDrcResult.errors,
        circuitJson: autoroutingBaselineViaCircuitJson,
        evaluatedTraceIds: baselineEvaluatedTraceIds,
      }),
      errorsWithCenters: addAutoroutingViaTraceIds({
        errors: autoroutingBaselineDrcResult.errorsWithCenters,
        circuitJson: autoroutingBaselineViaCircuitJson,
        evaluatedTraceIds: baselineEvaluatedTraceIds,
      }),
    }
    let referenceDrcCandidateCache:
      | {
          candidateKey: string
          result: ReturnType<DrcEvaluator>
        }
      | undefined

    const prepareCandidateDrcInput = (
      evaluatedRoutes: HighDensityRoute[],
    ): PreparedCandidateDrcInput => {
      const evaluatedNewRoutes = evaluatedRoutes.filter(
        (route) => !this.syntheticConnectionNames.has(route.connectionName),
      )
      const evaluatedNewTraces = convertNewRoutes(evaluatedNewRoutes)
      const uniquelyNamedNewTraces = assignUniquePcbTraceIdsToNewTraces(
        evaluatedNewTraces,
        params.originalSrj.traces ?? [],
      )
      const replacedOriginalTraceIds = new Set<string>()
      const originalTraceIdByEvaluationTraceId = new Map<string, string>()
      const evaluatedMovablePreloadedTraces = this.movablePreloadedSections.map(
        (movableSection) => {
          const evaluatedRoute = evaluatedRoutes.find(
            (route) =>
              route.connectionName === movableSection.syntheticConnectionName,
          )
          if (!evaluatedRoute) {
            throw new Error(
              `Pipeline9 joint DRC repair lost preloaded section "${movableSection.syntheticConnectionName}"`,
            )
          }
          const originalTraceId = movableSection.originalTrace.pcb_trace_id
          originalTraceIdByEvaluationTraceId.set(
            movableSection.evaluationTraceId,
            originalTraceId,
          )
          const replacesOriginalTrace =
            !replacedOriginalTraceIds.has(originalTraceId)
          replacedOriginalTraceIds.add(originalTraceId)
          return {
            ...movableSection.originalTrace,
            pcb_trace_id: movableSection.evaluationTraceId,
            ...(replacesOriginalTrace
              ? { __replaces_pcb_trace_id: originalTraceId }
              : { __replaces_pcb_trace_id: undefined }),
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
      for (const movableSection of this.movablePreloadedSections) {
        solverTraceIdByEvaluationTraceId.set(
          movableSection.evaluationTraceId,
          `${movableSection.syntheticConnectionName}_0`,
        )
      }
      const movableTraceIds = new Set(solverTraceIdByEvaluationTraceId.values())
      const routedTraces = [
        ...nonMovableMutatedPreloadedTraces,
        ...evaluatedMovablePreloadedTraces,
        ...uniquelyNamedNewTraces,
      ]
      const evaluatedTraces = combinePreloadedAndRoutedTraces(
        params.originalSrj.traces ?? [],
        routedTraces,
      )
      return {
        evaluatedTraces,
        movableTraceIds,
        originalTraceIdByEvaluationTraceId,
        routedTraces,
        solverTraceIdByEvaluationTraceId,
      }
    }
    const normalizeCandidateDrcResult = ({
      errors,
      errorsWithCenters,
      circuitJson,
      movableTraceIds,
      solverTraceIdByEvaluationTraceId,
    }: {
      errors: Array<Record<string, unknown>>
      errorsWithCenters: Array<Record<string, unknown>>
      circuitJson: AnyCircuitElement[]
      movableTraceIds: ReadonlySet<string>
      solverTraceIdByEvaluationTraceId: ReadonlyMap<string, string>
    }): NormalizedCandidateDrcResult => {
      const remappedCircuitJson = circuitJson.map((element) => {
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
          errors: remapDrcTraceIds(errors, solverTraceIdByEvaluationTraceId),
          circuitJson: remappedCircuitJson,
          newTraceIds: movableTraceIds,
        }),
        errorsWithCenters: normalizePipeline9DrcErrorsForRepair({
          errors: remapDrcTraceIds(
            errorsWithCenters,
            solverTraceIdByEvaluationTraceId,
          ),
          circuitJson: remappedCircuitJson,
          newTraceIds: movableTraceIds,
        }),
      }
    }

    const referenceDrcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
      const evaluatedRoutes = routes ?? hdRoutes
      if (!evaluatedRoutes) {
        throw new Error("Pipeline9 reference DRC repair requires HD routes")
      }
      const candidateDrcInput = prepareCandidateDrcInput(evaluatedRoutes)
      const evaluatedDrc = evaluateRelaxedDrc({
        inputSrj: params.originalSrj,
        srjWithPointPairs: params.srjWithPointPairs,
        routedTraces: candidateDrcInput.routedTraces,
        drcOptions: { traceClearance },
      })
      const evaluatedTraceIds = new Set(
        candidateDrcInput.evaluatedTraces.map((trace) => trace.pcb_trace_id),
      )
      const evaluatedErrors = addAutoroutingViaTraceIds({
        errors: evaluatedDrc.errors as unknown as Array<
          Record<string, unknown>
        >,
        circuitJson: evaluatedDrc.circuitJson,
        evaluatedTraceIds,
      })
      const evaluatedErrorsWithCenters = addAutoroutingViaTraceIds({
        errors: evaluatedDrc.errorsWithCenters as unknown as Array<
          Record<string, unknown>
        >,
        circuitJson: evaluatedDrc.circuitJson,
        evaluatedTraceIds,
      })
      const evaluatedNewErrors = filterPipeline9DrcErrorsAgainstBaseline({
        errors: evaluatedErrors,
        baselineErrors,
        originalTraceIdByPreparedTraceId:
          candidateDrcInput.originalTraceIdByEvaluationTraceId,
      })
      const evaluatedNewErrorsWithCenters =
        filterPipeline9DrcErrorsAgainstBaseline({
          errors: evaluatedErrorsWithCenters,
          baselineErrors: baselineErrorsWithCenters,
          originalTraceIdByPreparedTraceId:
            candidateDrcInput.originalTraceIdByEvaluationTraceId,
        })
      return normalizeCandidateDrcResult({
        errors: evaluatedNewErrors,
        errorsWithCenters: evaluatedNewErrorsWithCenters,
        circuitJson: evaluatedDrc.circuitJson,
        movableTraceIds: candidateDrcInput.movableTraceIds,
        solverTraceIdByEvaluationTraceId:
          candidateDrcInput.solverTraceIdByEvaluationTraceId,
      })
    }
    const cachedReferenceDrcEvaluator: DrcEvaluator = ({
      routes,
      hdRoutes,
    }) => {
      const evaluatedRoutes = routes ?? hdRoutes
      if (!evaluatedRoutes) {
        throw new Error("Pipeline9 cached reference DRC requires HD routes")
      }
      const candidateKey = JSON.stringify(evaluatedRoutes)
      if (referenceDrcCandidateCache?.candidateKey === candidateKey) {
        return referenceDrcCandidateCache.result
      }
      this.referenceDrcValidationCount += 1
      const result = referenceDrcEvaluator({
        traces: [],
        routes: evaluatedRoutes,
        hdRoutes: evaluatedRoutes,
      })
      referenceDrcCandidateCache = { candidateKey, result }
      return result
    }
    this.cachedReferenceDrcEvaluator = cachedReferenceDrcEvaluator

    const drcEvaluator: DrcEvaluator = ({ routes, hdRoutes }) => {
      const evaluatedRoutes = routes ?? hdRoutes
      if (!evaluatedRoutes) {
        throw new Error("Pipeline9 joint DRC repair requires HD routes")
      }
      const candidateKey = JSON.stringify(evaluatedRoutes) as DrcCandidateKey
      const cachedResult = this.indexedDrcCandidateCache.get(candidateKey)
      if (cachedResult !== undefined) {
        this.indexedDrcCacheHitCount += 1
        return cachedResult
      }
      const evaluationStartedAtMs = performance.now()
      this.indexedDrcEvaluationCount += 1
      const candidateDrcInput = prepareCandidateDrcInput(evaluatedRoutes)
      const evaluatedDrc = autoroutingDrcEngine.evaluate(
        candidateDrcInput.evaluatedTraces as RepairSimplifiedPcbTraces,
      )
      const viaCircuitJson = getAutoroutingViaElements(
        candidateDrcInput.evaluatedTraces,
      )
      const evaluatedTraceIds = new Set(
        candidateDrcInput.evaluatedTraces.map((trace) => trace.pcb_trace_id),
      )
      const evaluatedErrors = addAutoroutingViaTraceIds({
        errors: evaluatedDrc.errors as unknown as Array<
          Record<string, unknown>
        >,
        circuitJson: viaCircuitJson,
        evaluatedTraceIds,
      })
      const evaluatedErrorsWithCenters = addAutoroutingViaTraceIds({
        errors: evaluatedDrc.errorsWithCenters as unknown as Array<
          Record<string, unknown>
        >,
        circuitJson: viaCircuitJson,
        evaluatedTraceIds,
      })
      const evaluatedNewErrors = filterPipeline9DrcErrorsAgainstBaseline({
        errors: evaluatedErrors,
        baselineErrors: autoroutingBaselineDrc.errors as unknown as Array<
          Record<string, unknown>
        >,
        originalTraceIdByPreparedTraceId:
          candidateDrcInput.originalTraceIdByEvaluationTraceId,
      })
      const evaluatedNewErrorsWithCenters =
        filterPipeline9DrcErrorsAgainstBaseline({
          errors: evaluatedErrorsWithCenters,
          baselineErrors:
            autoroutingBaselineDrc.errorsWithCenters as unknown as Array<
              Record<string, unknown>
            >,
          originalTraceIdByPreparedTraceId:
            candidateDrcInput.originalTraceIdByEvaluationTraceId,
        })
      if (evaluatedNewErrors.length === 0) {
        const validationCountBefore = this.referenceDrcValidationCount
        const referenceResult = cachedReferenceDrcEvaluator({
          traces: [],
          routes: evaluatedRoutes,
          hdRoutes: evaluatedRoutes,
        })
        const referenceErrors = Array.isArray(referenceResult)
          ? referenceResult
          : referenceResult.errors
        if (
          this.referenceDrcValidationCount > validationCountBefore &&
          referenceErrors.length > 0
        ) {
          this.referenceDrcFalseNegativeCount += 1
        }
        this.indexedDrcEvaluationTimeMs +=
          performance.now() - evaluationStartedAtMs
        this.cacheIndexedDrcResult(candidateKey, referenceResult)
        return referenceResult
      }
      const candidateDrcResult = normalizeCandidateDrcResult({
        errors: evaluatedNewErrors,
        errorsWithCenters: evaluatedNewErrorsWithCenters,
        circuitJson: viaCircuitJson,
        movableTraceIds: candidateDrcInput.movableTraceIds,
        solverTraceIdByEvaluationTraceId:
          candidateDrcInput.solverTraceIdByEvaluationTraceId,
      })
      this.indexedDrcEvaluationTimeMs +=
        performance.now() - evaluationStartedAtMs
      this.cacheIndexedDrcResult(candidateKey, candidateDrcResult)
      return candidateDrcResult
    }
    this.drcEvaluator = drcEvaluator

    this.exactRepairSolver = new Pipeline7AdaptiveDrcBranchPortfolioSolver({
      srj: extendedSrjWithPointPairs as any,
      hdRoutes: [
        ...params.newHdRoutes,
        ...this.movablePreloadedSections.map(
          (movableSection) => movableSection.hdRoute,
        ),
      ],
      connMap: params.connMap,
      effort: params.effort,
      viaHoleDiameter: params.defaultViaHoleDiameter,
      drcEvaluator,
      viaInPadDrcEvaluator: drcEvaluator,
      maxIterations: EXACT_REPAIR_MAX_ITERATIONS,
      enableBroadFallback: false,
      enableLargeBoardBroadFallback: false,
      enableTargetedErrorSweep: true,
      enableTraceViaOwnerTargeting: true,
      enablePostSolveClearanceRelaxation: false,
      enableSafeTraceLayerMoves: true,
      enableViaInPadLayerMoves: params.originalSrj.allowViaInPad ?? false,
      viaInPadMaxIterations: EXACT_REPAIR_MAX_ITERATIONS,
      broadMaxIterations: EXACT_REPAIR_BROAD_MAX_ITERATIONS,
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
    const exactOutput = this.exactRepairSolver.getOutput()
    const exactIndexedDrcIssueCountStat =
      this.exactRepairSolver.stats.finalDrcIssueCount
    const exactIndexedDrcIssueCount =
      typeof exactIndexedDrcIssueCountStat === "number" &&
      Number.isFinite(exactIndexedDrcIssueCountStat) &&
      exactIndexedDrcIssueCountStat >= 0
        ? exactIndexedDrcIssueCountStat
        : undefined
    const shouldRunPostExactPrecisionPass =
      exactIndexedDrcIssueCount === undefined ||
      exactIndexedDrcIssueCount <=
        MAX_POST_EXACT_PRECISION_PASS_INDEXED_ISSUE_COUNT
    let postExactReferenceDrcIssueCount: number | undefined
    if (shouldRunPostExactPrecisionPass) {
      // The indexed evaluator can retain conservative false positives after the
      // exact portfolio has produced a reference-clean result. Do not let later
      // heuristic repairs degrade an output already accepted by benchmark DRC.
      const exactReferenceDrcResult = this.cachedReferenceDrcEvaluator!({
        traces: [],
        routes: exactOutput,
        hdRoutes: exactOutput,
      })
      const exactReferenceDrcErrors = Array.isArray(exactReferenceDrcResult)
        ? exactReferenceDrcResult
        : exactReferenceDrcResult.errors
      postExactReferenceDrcIssueCount = exactReferenceDrcErrors.length
      if (exactReferenceDrcErrors.length === 0) {
        this.combinedOutput = exactOutput
        this.stats = {
          ...this.stats,
          ...this.exactRepairSolver.stats,
          postExactIndexedDrcIssueCount: exactIndexedDrcIssueCount,
          postExactPrecisionPassMaxIndexedIssueCount:
            MAX_POST_EXACT_PRECISION_PASS_INDEXED_ISSUE_COUNT,
          postExactPrecisionPassAttempted: true,
          postExactReferenceValidationAttempted: true,
          postExactReferenceValidationSkippedForIndexedIssueCount: false,
          postExactReferenceDrcIssueCount: 0,
          postExactReferenceAccepted: true,
          regionalB01RepairCandidateCount: 0,
          regionalB01RepairAcceptedCount: 0,
          regionalB01RepairFallbackCandidateCount: 0,
          regionalB01RepairCandidateSearchCount: 0,
          regionalB01RepairCandidateSearchBudget: 0,
          regionalB01RepairCandidateSearchBudgetExhausted: false,
          regionalB01RepairSafeTraceLayerSkippedForBudget: false,
          regionalB01RepairRemainingDrcIssueCount: 0,
          regionalB01RepairPreloadEligibleDrcIssueCount: 0,
          regionalB01RepairAttempted: false,
          regionalB01RepairTraceIdCount: 0,
          terminalEscapeSkippedForIndexedIssueCount: false,
          terminalEscapeCandidateCount: 0,
          terminalEscapeAcceptedCount: 0,
          referenceDrcValidationCount: this.referenceDrcValidationCount,
          referenceDrcFalseNegativeCount: this.referenceDrcFalseNegativeCount,
          indexedDrcEvaluationCount: this.indexedDrcEvaluationCount,
          indexedDrcCacheHitCount: this.indexedDrcCacheHitCount,
          indexedDrcEvaluationTimeMs: this.indexedDrcEvaluationTimeMs,
          indexedDrcCandidateCacheSize: this.indexedDrcCandidateCache.size,
          indexedDrcCandidateCacheCapacity: INDEXED_DRC_CANDIDATE_CACHE_SIZE,
        }
        this.solved = true
        return
      }
    }
    const terminalEscapeResult = shouldRunPostExactPrecisionPass
      ? applyPipeline9TerminalEscapeRelocations({
          srj: this.params.srj,
          routes: exactOutput,
          newConnections: this.params.newConnections,
          syntheticConnectionNames: this.syntheticConnectionNames,
          drcEvaluator: this.drcEvaluator!,
        })
      : {
          routes: exactOutput,
          attemptedCandidateCount: 0,
          acceptedCandidateCount: 0,
          remainingErrors: getPipeline9DrcErrors(
            this.drcEvaluator!,
            exactOutput,
          ),
        }
    const preloadRepairTraceIds = getPipeline9PreloadRepairTraceIds({
      routes: terminalEscapeResult.routes,
      newConnections: this.params.newConnections,
      syntheticConnectionNames: this.syntheticConnectionNames,
      fixedPreloadedObstacleRoutes: this.fixedPreloadedObstacleRoutes,
      updatedPreloadedTraces: this.params.updatedPreloadedTraces,
    })
    const regionalB01RepairResult = applyPipeline9RegionalB01Repairs({
      srj: this.params.srj,
      routes: terminalEscapeResult.routes,
      fixedObstacleRoutes: this.fixedPreloadedObstacleRoutes,
      newConnections: this.params.newConnections,
      syntheticConnectionNames: this.syntheticConnectionNames,
      drcEvaluator: this.drcEvaluator!,
      initialErrors: terminalEscapeResult.remainingErrors,
      preloadRepairTraceIds,
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
      postExactIndexedDrcIssueCount: exactIndexedDrcIssueCount,
      postExactPrecisionPassMaxIndexedIssueCount:
        MAX_POST_EXACT_PRECISION_PASS_INDEXED_ISSUE_COUNT,
      postExactPrecisionPassAttempted: shouldRunPostExactPrecisionPass,
      postExactReferenceValidationAttempted: shouldRunPostExactPrecisionPass,
      postExactReferenceValidationSkippedForIndexedIssueCount:
        !shouldRunPostExactPrecisionPass,
      postExactReferenceDrcIssueCount,
      postExactReferenceAccepted: false,
      regionalB01RepairCandidateCount:
        regionalB01RepairResult.attemptedCandidateCount,
      regionalB01RepairAcceptedCount:
        regionalB01RepairResult.acceptedCandidateCount,
      regionalB01RepairFallbackCandidateCount:
        regionalB01RepairResult.fallbackCandidateCount,
      regionalB01RepairCandidateSearchCount:
        regionalB01RepairResult.candidateSearchCount,
      regionalB01RepairCandidateSearchBudget:
        regionalB01RepairResult.candidateSearchBudget,
      regionalB01RepairCandidateSearchBudgetExhausted:
        regionalB01RepairResult.candidateSearchBudgetExhausted,
      regionalB01RepairSafeTraceLayerSkippedForBudget:
        regionalB01RepairResult.safeTraceLayerRepairSkippedForBudget,
      regionalB01RepairRemainingDrcIssueCount:
        regionalB01RepairResult.remainingDrcIssueCount,
      regionalB01RepairPreloadEligibleDrcIssueCount:
        regionalB01RepairResult.preloadEligibleDrcIssueCount,
      regionalB01RepairAttempted:
        regionalB01RepairResult.preloadRepairAttempted,
      regionalB01RepairTraceIdCount:
        preloadRepairTraceIds.size +
        (preloadRepairTraceIds.collidingFixedTraceIds?.size ?? 0),
      terminalEscapeSkippedForIndexedIssueCount:
        !shouldRunPostExactPrecisionPass,
      terminalEscapeCandidateCount:
        terminalEscapeResult.attemptedCandidateCount,
      terminalEscapeAcceptedCount: terminalEscapeResult.acceptedCandidateCount,
      referenceDrcValidationCount: this.referenceDrcValidationCount,
      referenceDrcFalseNegativeCount: this.referenceDrcFalseNegativeCount,
      indexedDrcEvaluationCount: this.indexedDrcEvaluationCount,
      indexedDrcCacheHitCount: this.indexedDrcCacheHitCount,
      indexedDrcEvaluationTimeMs: this.indexedDrcEvaluationTimeMs,
      indexedDrcCandidateCacheSize: this.indexedDrcCandidateCache.size,
      indexedDrcCandidateCacheCapacity: INDEXED_DRC_CANDIDATE_CACHE_SIZE,
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
    const repairedSectionsByOriginalTraceId = new Map<
      string,
      Array<{
        routePositionStart: number
        routePositionEnd: number
        route: SimplifiedPcbTrace["route"]
      }>
    >()
    for (const movableSection of this.movablePreloadedSections) {
      const outputRoute = outputRouteByConnectionName.get(
        movableSection.syntheticConnectionName,
      )
      if (!outputRoute) {
        throw new Error(
          `Pipeline9 joint DRC repair output is missing "${movableSection.syntheticConnectionName}"`,
        )
      }
      const originalTraceId = movableSection.originalTrace.pcb_trace_id
      const repairedSections =
        repairedSectionsByOriginalTraceId.get(originalTraceId) ?? []
      repairedSections.push({
        routePositionStart: movableSection.originalRoutePositionStart,
        routePositionEnd: movableSection.originalRoutePositionEnd,
        route: convertHdRouteToSimplifiedRoute(
          outputRoute,
          this.params.layerCount,
          {
            defaultViaHoleDiameter: this.params.defaultViaHoleDiameter,
            obstacles: this.params.obstacles,
            connMap: this.params.connMap,
          },
        ),
      })
      repairedSectionsByOriginalTraceId.set(originalTraceId, repairedSections)
    }
    const repairedTraceById = new Map(
      [...repairedSectionsByOriginalTraceId].map(
        ([originalTraceId, repairedSections]) => {
          const originalTrace = this.inputUpdatedPreloadedTraces.find(
            (trace) => trace.pcb_trace_id === originalTraceId,
          )
          if (!originalTrace) {
            throw new Error(
              `Pipeline9 cannot find preloaded trace "${originalTraceId}" while rebuilding repaired sections`,
            )
          }
          return [
            originalTraceId,
            rebuildPreloadedTraceFromSections({
              originalTrace,
              repairedSections,
            }),
          ] as const
        },
      ),
    )
    return this.inputUpdatedPreloadedTraces.map(
      (trace) => repairedTraceById.get(trace.pcb_trace_id) ?? trace,
    )
  }

  getMutatedPreloadedTraces(): SimplifiedPcbTrace[] {
    const mutatedTraceIds = new Set([
      ...this.params.mutatedPreloadedTraceIds,
      ...this.movablePreloadedSections.map(
        (movableSection) => movableSection.originalTrace.pcb_trace_id,
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
