import { calculate45DegreePaths } from "lib/utils/calculate45DegreePaths"
import { doesSegmentCrossPolygonBoundary } from "lib/utils/polygonContainment"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { breakRouteIntoSections } from "lib/solvers/UselessViaRemovalSolver/break-route-into-sections"
import { canSectionMoveToLayer } from "lib/solvers/UselessViaRemovalSolver/can-section-move-to-layer"
import { rebuildAndValidateRouteVias } from "./rebuild-and-validate-route-vias"

const pathLength = (points: HighDensityRoute["route"]): number =>
  points
    .slice(1)
    .reduce(
      (length, point, index) =>
        length +
        Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
      0,
    )

const crossesOutline = (
  points: HighDensityRoute["route"],
  outline: ReadonlyArray<{ x: number; y: number }> | undefined,
): boolean =>
  Boolean(
    outline &&
      outline.length >= 3 &&
      points.slice(1).some((point, index) =>
        doesSegmentCrossPolygonBoundary({
          start: points[index]!,
          end: point,
          polygon: [...outline],
        }),
      ),
  )

const getLayerTransitionCount = (route: HighDensityRoute): number =>
  route.route
    .slice(1)
    .filter((point, index) => point.z !== route.route[index]!.z).length

export type SameLayerSpanCollapseCandidate = {
  route: HighDensityRoute
  removedTransitionCount: number
  lengthSaved: number
}

/** Enumerates a small deterministic shortlist of maximal A→…→A collapses. */
export const getSameLayerSpanCollapseCandidates = ({
  route,
  hdRouteSHI,
  obstacleSHI,
  connMap,
  outline,
  maxCandidates = 4,
}: {
  route: HighDensityRoute
  hdRouteSHI: HighDensityRouteSpatialIndex
  obstacleSHI: ObstacleSpatialHashIndex
  connMap: ConnectivityMap
  outline?: ReadonlyArray<{ x: number; y: number }>
  maxCandidates?: number
}): SameLayerSpanCollapseCandidate[] => {
  const sections = breakRouteIntoSections(route)
  const candidates: SameLayerSpanCollapseCandidate[] = []
  const candidateKeys = new Set<string>()
  const originalTransitionCount = getLayerTransitionCount(route)
  for (
    let startSectionIndex = 0;
    startSectionIndex < sections.length - 2;
    startSectionIndex++
  ) {
    const startSection = sections[startSectionIndex]!
    for (
      let endSectionIndex = sections.length - 1;
      endSectionIndex >= startSectionIndex + 2;
      endSectionIndex--
    ) {
      const endSection = sections[endSectionIndex]!
      if (startSection.z !== endSection.z) continue
      const start = startSection.points[startSection.points.length - 1]!
      const end = endSection.points[0]!
      const removed = route.route.slice(
        startSection.endIndex,
        endSection.startIndex + 1,
      )
      if (
        removed.some(
          (point) => point.insideJumperPad || point.toNextSegmentType,
        )
      )
        continue

      for (const candidatePath of calculate45DegreePaths(start, end)) {
        const replacement = candidatePath.map((point, index) =>
          index === 0
            ? { ...start }
            : index === candidatePath.length - 1
              ? { ...end }
              : { x: point.x, y: point.y, z: start.z },
        )
        if (pathLength(replacement) > pathLength(removed) + 1e-6) continue
        if (crossesOutline(replacement, outline)) continue
        if (
          !canSectionMoveToLayer({
            currentSection: {
              startIndex: startSection.endIndex,
              endIndex: endSection.startIndex,
              z: start.z,
              points: replacement,
            },
            targetZ: start.z,
            route,
            hdRouteSHI,
            obstacleSHI,
            connMap,
            defaultTraceThickness: route.traceThickness,
            obstacleMargin: 0.15,
            traceMargin: 0.1,
          })
        )
          continue

        const candidate = rebuildAndValidateRouteVias({
          ...route,
          route: [
            ...route.route.slice(0, startSection.endIndex),
            ...replacement,
            ...route.route.slice(endSection.startIndex + 1),
          ],
        })
        if (!candidate) continue
        const removedTransitionCount =
          originalTransitionCount - getLayerTransitionCount(candidate)
        if (removedTransitionCount <= 0) continue
        const key = candidate.route
          .map((point) => `${point.x}:${point.y}:${point.z}`)
          .join("|")
        if (candidateKeys.has(key)) continue
        candidateKeys.add(key)
        candidates.push({
          route: candidate,
          removedTransitionCount,
          lengthSaved: pathLength(removed) - pathLength(replacement),
        })
      }
    }
  }
  return candidates
    .sort((a, b) => {
      if (b.removedTransitionCount !== a.removedTransitionCount) {
        return b.removedTransitionCount - a.removedTransitionCount
      }
      return b.lengthSaved - a.lengthSaved
    })
    .slice(0, maxCandidates)
}

/** Finds the strongest same-layer excursion candidate for existing callers. */
export const tryCollapseSameLayerSpan = (
  input: Parameters<typeof getSameLayerSpanCollapseCandidates>[0],
): HighDensityRoute | null =>
  getSameLayerSpanCollapseCandidates(input)[0]?.route ?? null
