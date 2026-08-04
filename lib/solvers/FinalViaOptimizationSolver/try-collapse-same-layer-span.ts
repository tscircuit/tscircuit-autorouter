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
  points.slice(1).reduce(
    (length, point, index) =>
      length + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
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

/** Finds one maximal A→…→A excursion that can safely become same-layer copper. */
export const tryCollapseSameLayerSpan = ({
  route,
  hdRouteSHI,
  obstacleSHI,
  connMap,
  outline,
}: {
  route: HighDensityRoute
  hdRouteSHI: HighDensityRouteSpatialIndex
  obstacleSHI: ObstacleSpatialHashIndex
  connMap: ConnectivityMap
  outline?: ReadonlyArray<{ x: number; y: number }>
}): HighDensityRoute | null => {
  const sections = breakRouteIntoSections(route)
  for (let startSectionIndex = 0; startSectionIndex < sections.length - 2; startSectionIndex++) {
    const startSection = sections[startSectionIndex]!
    for (let endSectionIndex = sections.length - 1; endSectionIndex >= startSectionIndex + 2; endSectionIndex--) {
      const endSection = sections[endSectionIndex]!
      if (startSection.z !== endSection.z) continue
      const start = startSection.points[startSection.points.length - 1]!
      const end = endSection.points[0]!
      const removed = route.route.slice(startSection.endIndex, endSection.startIndex + 1)
      if (removed.some((point) => point.insideJumperPad || point.toNextSegmentType)) continue

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
        if (!canSectionMoveToLayer({
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
        })) continue

        const candidate = rebuildAndValidateRouteVias({
          ...route,
          route: [
            ...route.route.slice(0, startSection.endIndex),
            ...replacement,
            ...route.route.slice(endSection.startIndex + 1),
          ],
        })
        if (candidate) return candidate
      }
    }
  }
  return null
}
