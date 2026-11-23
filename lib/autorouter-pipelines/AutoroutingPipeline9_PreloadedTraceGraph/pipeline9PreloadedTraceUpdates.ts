import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { applyFixedRouteReplacementsToPreloadedTraces } from "./applyFixedRouteReplacementsToPreloadedTraces"
import {
  getMaterializedPreloadedSectionHdRoutes,
  removeChangedSectionsFromFixedHdRoutes,
} from "./materializeHypergraphPreloadedTraceSections"
import {
  type PreparedPipeline9MutationSections,
  applyPipeline9MutatedPreloadedSections,
  preparePipeline9MutatedPreloadedSections,
} from "./pipeline9MutatedPreloadedTraceSimplification"
import {
  convertPreloadedTraceToHdRoutes,
  type PreloadedHighDensityRoute,
} from "./convertPreloadedTraceToHdRoutes"
import type { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./AutoroutingPipelineSolver9_PreloadedTraceGraph"

type ConnectionName = HighDensityRoute["connectionName"]

type Pipeline9PreloadedFixedRouteState = {
  originalFixedRoutes: PreloadedHighDensityRoute[]
  updatedFixedRoutes: PreloadedHighDensityRoute[]
  replacedConnectionNames: Set<ConnectionName>
  mutationMasks: Map<ConnectionName, boolean[]>
}

export function getOriginalFixedHdRoutes(
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): PreloadedHighDensityRoute[] {
  return (pipeline.routingInput.traces ?? []).flatMap((trace, traceIndex) =>
    convertPreloadedTraceToHdRoutes(
      trace,
      traceIndex,
      pipeline.originalSrj.layerCount,
      pipeline.viaDiameter,
      pipeline.connMap,
    ),
  )
}

export function getChangedPreloadedTraceSections(
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): ChangedPreloadedTraceSection[] {
  return (
    pipeline.portPointPathingSolver?.getOutput()
      .changedPreloadedTraceSections ?? []
  )
}

function getPreloadedFixedRouteStateAfterHighDensity(
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): Pipeline9PreloadedFixedRouteState {
  const originalFixedRoutes = getOriginalFixedHdRoutes(pipeline)
  const changedSections = getChangedPreloadedTraceSections(pipeline)
  const fixedRoutesWithoutChangedSections =
    removeChangedSectionsFromFixedHdRoutes({
      traces: pipeline.routingInput.traces ?? [],
      fixedHdRoutes: originalFixedRoutes,
      sections: changedSections,
    })
  const materializedSectionRoutes =
    changedSections.length === 0
      ? []
      : getMaterializedPreloadedSectionHdRoutes({
          traces: pipeline.routingInput.traces ?? [],
          sections: changedSections,
          stitchedHdRoutes:
            pipeline.highDensityStitchSolver?.mergedHdRoutes ?? [],
          layerCount: pipeline.originalSrj.layerCount,
        })
  const materializedTraceIds = new Set(
    changedSections.map((section) => section.traceId),
  )
  const materializedOriginalRouteNames = originalFixedRoutes
    .filter((route) =>
      materializedTraceIds.has(
        pipeline.routingInput.traces?.[route.preloadedTraceIndex]
          ?.pcb_trace_id ?? "",
      ),
    )
    .map((route) => route.connectionName)
  return {
    originalFixedRoutes,
    updatedFixedRoutes: [
      ...(pipeline.highDensityRouteSolver?.getUpdatedFixedHdRoutes() ??
        fixedRoutesWithoutChangedSections),
      ...materializedSectionRoutes,
    ],
    replacedConnectionNames: new Set([
      ...(pipeline.highDensityRouteSolver?.fixedRouteReplacements.keys() ?? []),
      ...materializedOriginalRouteNames,
    ]),
    mutationMasks: new Map([
      ...(pipeline.highDensityRouteSolver?.preloadedTraceMutationMasks ?? []),
      ...materializedSectionRoutes.map(
        (route) =>
          [
            route.connectionName,
            Array(route.route.length - 1).fill(true),
          ] as const,
      ),
    ]),
  }
}

export function getPreparedMutatedPreloadedTraceSections(
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): PreparedPipeline9MutationSections {
  const fixedRouteState = getPreloadedFixedRouteStateAfterHighDensity(pipeline)
  return preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: fixedRouteState.updatedFixedRoutes,
    regionalMutationMasks: fixedRouteState.mutationMasks,
  })
}

export function getPreloadedTraceUpdatesAfterHighDensity(
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): ReturnType<typeof applyFixedRouteReplacementsToPreloadedTraces> {
  const fixedRouteState = getPreloadedFixedRouteStateAfterHighDensity(pipeline)
  const preparedSections = getPreparedMutatedPreloadedTraceSections(pipeline)
  const updatedFixedRoutes =
    pipeline.mutatedPreloadedTraceSimplificationSolver?.solved === true
      ? applyPipeline9MutatedPreloadedSections({
          updatedFixedRoutes: preparedSections.normalizedFixedRoutes,
          sections: preparedSections.sections,
          simplifiedHdRoutes:
            pipeline.mutatedPreloadedTraceSimplificationSolver
              .simplifiedHdRoutes,
        })
      : fixedRouteState.updatedFixedRoutes

  return applyFixedRouteReplacementsToPreloadedTraces({
    originalTraces: pipeline.routingInput.traces ?? [],
    originalFixedRoutes: fixedRouteState.originalFixedRoutes,
    updatedFixedRoutes,
    replacedConnectionNames: fixedRouteState.replacedConnectionNames,
    layerCount: pipeline.originalSrj.layerCount,
    defaultViaHoleDiameter: pipeline.viaHoleDiameter,
    obstacles: pipeline.originalSrj.obstacles,
    connMap: pipeline.connMap,
  })
}

export function getSrjWithMaterializedPreloadedTraces(
  pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph,
): SimpleRouteJson {
  return {
    ...pipeline.srjWithPointPairs!,
    traces:
      getPreloadedTraceUpdatesAfterHighDensity(pipeline).updatedPreloadedTraces,
  }
}
