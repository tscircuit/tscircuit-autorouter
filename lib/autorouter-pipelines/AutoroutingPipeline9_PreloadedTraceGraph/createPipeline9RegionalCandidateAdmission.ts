import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"
import { createImmutableCopperCandidateAdmission } from "./createImmutableCopperCandidateAdmission"
import { createPipeline9CopperAdmissionSerializer } from "./createPipeline9CopperAdmissionSerializer"
import {
  type FixedRouteSection,
  spliceFixedRouteSectionWithMutationMask,
} from "./pipeline9RegionalFallback"

type AdmissionParams = {
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  currentFixedRoutes: readonly PreloadedHighDensityRoute[]
  acceptedRoutes: readonly HighDensityRoute[]
  sections: ReadonlyMap<string, FixedRouteSection>
  sourceMutationMasks: ReadonlyMap<string, boolean[]>
  publishedTraceIndexes?: ReadonlySet<number>
}

/** Validate exactly the copper a regional splice will publish, against its input. */
export const createPipeline9RegionalCandidateAdmission = ({
  srj,
  connMap,
  currentFixedRoutes,
  acceptedRoutes,
  sections,
  sourceMutationMasks,
  publishedTraceIndexes = new Set(),
}: AdmissionParams): ((
  routes: readonly HighDensityRoute[],
  checkMovableCopper?: boolean,
) => boolean) => {
  const { serialize, canonicalOwnerByTraceId, generatedTraceIds } =
    createPipeline9CopperAdmissionSerializer({ srj, connMap })
  const movableTraceIndexes = new Set(
    [...sections.values()].flatMap((section): number[] =>
      section.sourceRoutes.map((route): number => route.preloadedTraceIndex),
    ),
  )
  const moving = currentFixedRoutes.filter(
    (route): boolean =>
      movableTraceIndexes.has(route.preloadedTraceIndex) &&
      !route.isThroughObstacle,
  )
  const immutable = currentFixedRoutes.filter(
    (route): boolean =>
      !movableTraceIndexes.has(route.preloadedTraceIndex) ||
      route.isThroughObstacle === true,
  )
  const admit = createImmutableCopperCandidateAdmission({
    srj,
    connMap,
    initialMovableTraces: serialize(moving, publishedTraceIndexes),
    immutableTraces: serialize(immutable, publishedTraceIndexes),
    peerTraces: serialize(acceptedRoutes),
    includeMovableCopper: true,
    boardObstacles: srj.obstacles,
    canonicalOwnerByTraceId,
    generatedTraceIds,
  })
  return (routes, checkMovableCopper = true): boolean => {
    const replacements = new Map<string, PreloadedHighDensityRoute>()
    const removed = new Set<string>()
    const newRoutes: HighDensityRoute[] = []
    for (const route of routes) {
      const section = sections.get(route.connectionName)
      if (!section) {
        newRoutes.push(route)
        continue
      }
      if (replacements.has(route.connectionName))
        throw new Error(
          `Regional candidate has duplicate fixed family "${route.connectionName}"`,
        )
      replacements.set(
        route.connectionName,
        spliceFixedRouteSectionWithMutationMask({
          section,
          replacement: route,
          sourceMutationMasks,
          replacementIsMutated: true,
        }).route,
      )
      for (const source of section.sourceRoutes.slice(1))
        removed.add(source.connectionName)
    }
    const proposedFixed = moving.flatMap((route): PreloadedHighDensityRoute[] =>
      removed.has(route.connectionName)
        ? []
        : [replacements.get(route.connectionName) ?? route],
    )
    const publishedIndexes = new Set([
      ...publishedTraceIndexes,
      ...[...replacements.values()].map(
        (route): number => route.preloadedTraceIndex,
      ),
    ])
    return admit(
      [...serialize(proposedFixed, publishedIndexes), ...serialize(newRoutes)],
      checkMovableCopper,
    )
  }
}
