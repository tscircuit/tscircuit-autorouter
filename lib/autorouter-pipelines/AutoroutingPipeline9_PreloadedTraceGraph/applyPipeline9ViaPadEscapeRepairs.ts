import type { DrcEvaluator } from "high-density-repair03/lib"
import type { Obstacle, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  getPipeline9DrcErrors,
  isPipeline9DrcCandidateBetter,
  type Pipeline9DrcError,
} from "./pipeline9JointDrcRepairUtils"
import { getPipeline9RouteCopperGeometry } from "./pipeline9FixedRouteCopper"

type ViaPadEscapeRepairResult = {
  routes: HighDensityRoute[]
  remainingErrors: Pipeline9DrcError[]
  attemptedCandidateCount: number
  acceptedCandidateCount: number
}

type Bounds = SimpleRouteJson["bounds"]

const getPointToObstacleDistance = (
  point: { x: number; y: number },
  obstacle: Obstacle,
): number => {
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  const localX = dx * Math.cos(radians) - dy * Math.sin(radians)
  const localY = dx * Math.sin(radians) + dy * Math.cos(radians)
  const outsideX = Math.max(Math.abs(localX) - obstacle.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - obstacle.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

const getObstacleZLayers = (
  obstacle: Obstacle,
  layerCount: number,
): number[] => {
  const existingZLayers = obstacle.__zLayers ?? obstacle.zLayers
  if (existingZLayers) return existingZLayers
  return obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
}

const getPadObstacle = (
  error: Pipeline9DrcError,
  obstacles: Obstacle[],
): Obstacle | undefined => {
  const errorPadIds = [
    ...(typeof error.pcb_pad_id === "string" ? [error.pcb_pad_id] : []),
    ...(Array.isArray(error.pcb_pad_ids)
      ? error.pcb_pad_ids.filter(
          (padId): padId is string => typeof padId === "string",
        )
      : []),
  ]
  const directObstacle = obstacles.find((obstacle) => {
    const metadata = obstacle.circuitJsonMetadata
    return errorPadIds.some(
      (padId) =>
        padId === obstacle.obstacleId ||
        padId === metadata?.pcb_smtpad_id ||
        padId === metadata?.pcb_plated_hole_id ||
        padId === metadata?.pcb_port_id,
    )
  })
  if (directObstacle) return directObstacle
  return obstacles.find((obstacle) =>
    errorPadIds.some((padId) => obstacle.connectedTo.includes(padId)),
  )
}

const getEscapeCenters = ({
  via,
  obstacle,
  clearance,
  bounds,
}: {
  via: { center: { x: number; y: number }; diameter: number }
  obstacle: Obstacle
  clearance: number
  bounds: Bounds
}): Array<{ x: number; y: number }> => {
  const radians = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = via.center.x - obstacle.center.x
  const dy = via.center.y - obstacle.center.y
  const localVia = {
    x: dx * Math.cos(radians) - dy * Math.sin(radians),
    y: dx * Math.sin(radians) + dy * Math.cos(radians),
  }
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  const minimumOffset = via.diameter / 2 + clearance + 0.006
  const nearestPoint = {
    x: Math.max(-halfWidth, Math.min(halfWidth, localVia.x)),
    y: Math.max(-halfHeight, Math.min(halfHeight, localVia.y)),
  }
  let outwardDirection = {
    x: localVia.x - nearestPoint.x,
    y: localVia.y - nearestPoint.y,
  }
  const distanceFromNearestPoint = Math.hypot(
    outwardDirection.x,
    outwardDirection.y,
  )
  if (distanceFromNearestPoint > 1e-9) {
    outwardDirection = {
      x: outwardDirection.x / distanceFromNearestPoint,
      y: outwardDirection.y / distanceFromNearestPoint,
    }
  } else {
    const exits = [
      { distance: localVia.x + halfWidth, x: -1, y: 0 },
      { distance: halfWidth - localVia.x, x: 1, y: 0 },
      { distance: localVia.y + halfHeight, x: 0, y: -1 },
      { distance: halfHeight - localVia.y, x: 0, y: 1 },
    ].sort((left, right) => left.distance - right.distance)
    outwardDirection = { x: exits[0]!.x, y: exits[0]!.y }
    nearestPoint.x =
      outwardDirection.x === 0
        ? localVia.x
        : outwardDirection.x * halfWidth
    nearestPoint.y =
      outwardDirection.y === 0
        ? localVia.y
        : outwardDirection.y * halfHeight
  }
  const offsetFactors = [1, 1.5, 2]
  const nearestBoundaryCenters = offsetFactors.map((offsetFactor) => ({
    x:
      nearestPoint.x + outwardDirection.x * minimumOffset * offsetFactor,
    y:
      nearestPoint.y + outwardDirection.y * minimumOffset * offsetFactor,
  }))
  const alignedCenters = offsetFactors.flatMap((offsetFactor) => {
    const offset = minimumOffset * offsetFactor
    return [
      { x: -halfWidth - offset, y: localVia.y },
      { x: halfWidth + offset, y: localVia.y },
      { x: localVia.x, y: -halfHeight - offset },
      { x: localVia.x, y: halfHeight + offset },
    ]
  })
  const cardinalCenters = offsetFactors.flatMap((offsetFactor) => {
    const offset = minimumOffset * offsetFactor
    return [
      {
        x: -halfWidth - offset,
        y: Math.max(-halfHeight, Math.min(halfHeight, localVia.y)),
      },
      {
        x: halfWidth + offset,
        y: Math.max(-halfHeight, Math.min(halfHeight, localVia.y)),
      },
      {
        x: Math.max(-halfWidth, Math.min(halfWidth, localVia.x)),
        y: -halfHeight - offset,
      },
      {
        x: Math.max(-halfWidth, Math.min(halfWidth, localVia.x)),
        y: halfHeight + offset,
      },
    ]
  })
  const localRadialCenters = [0.025, 0.05, 0.075, 0.1, 0.15, 0.2].flatMap(
    (offset) =>
      Array.from({ length: 16 }, (_, directionIndex) => {
        const angle = (directionIndex * Math.PI) / 8
        return {
          x: localVia.x + Math.cos(angle) * offset,
          y: localVia.y + Math.sin(angle) * offset,
        }
      }),
  )
  const candidateLocalCenters = [
    ...localRadialCenters,
    ...nearestBoundaryCenters,
    ...alignedCenters,
    ...cardinalCenters,
  ]
  const inverseRadians = -radians
  return candidateLocalCenters
    .map((point) => ({
      x:
        obstacle.center.x +
        point.x * Math.cos(inverseRadians) -
        point.y * Math.sin(inverseRadians),
      y:
        obstacle.center.y +
        point.x * Math.sin(inverseRadians) +
        point.y * Math.cos(inverseRadians),
    }))
    .filter((point) => {
      const radius = via.diameter / 2
      return (
        point.x - radius >= bounds.minX &&
        point.x + radius <= bounds.maxX &&
        point.y - radius >= bounds.minY &&
        point.y + radius <= bounds.maxY
      )
    })
    .sort(
      (left, right) =>
        Math.hypot(left.x - via.center.x, left.y - via.center.y) -
        Math.hypot(right.x - via.center.x, right.y - via.center.y),
    )
}

const getRadialEscapeCenters = ({
  via,
  clearance,
  traceWidth,
  bounds,
}: {
  via: { center: { x: number; y: number }; diameter: number }
  clearance: number
  traceWidth: number
  bounds: Bounds
}): Array<{ x: number; y: number }> => {
  const minimumOffset = via.diameter / 2 + traceWidth / 2 + clearance + 0.006
  return [1, 2]
    .flatMap((offsetFactor) =>
      Array.from({ length: 8 }, (_, directionIndex) => {
        const offset = minimumOffset * offsetFactor
        const angle = (directionIndex * Math.PI) / 4
        return {
          x: via.center.x + Math.cos(angle) * offset,
          y: via.center.y + Math.sin(angle) * offset,
        }
      }),
    )
    .filter((point) => {
      const radius = via.diameter / 2
      return (
        point.x - radius >= bounds.minX &&
        point.x + radius <= bounds.maxX &&
        point.y - radius >= bounds.minY &&
        point.y + radius <= bounds.maxY
      )
    })
}

const moveSharedVia = ({
  routes,
  from,
  to,
}: {
  routes: HighDensityRoute[]
  from: { x: number; y: number }
  to: { x: number; y: number }
}): HighDensityRoute[] => {
  const matches = (point: { x: number; y: number }) =>
    Math.hypot(point.x - from.x, point.y - from.y) <= 1e-6
  return routes.map((route) => {
    const routeOwnsVia = route.vias.some(matches) || route.route.some(matches)
    if (!routeOwnsVia) return route
    return {
      ...route,
      route: route.route.map((point) =>
        matches(point) ? { ...point, ...to } : point,
      ),
      vias: route.vias.map((via) => (matches(via) ? { ...via, ...to } : via)),
    }
  })
}

/** Moves every owner of a shared via together when pad forces cannot separate it. */
export const applyPipeline9ViaPadEscapeRepairs = ({
  srj,
  routes,
  drcEvaluator,
  initialErrors,
  clearance,
}: {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  initialErrors: Pipeline9DrcError[]
  clearance: number
}): ViaPadEscapeRepairResult => {
  let currentRoutes = routes
  let currentErrors = initialErrors
  let attemptedCandidateCount = 0
  let acceptedCandidateCount = 0
  const maximumAcceptedMoves = new Set(
    routes.flatMap((route) =>
      getPipeline9RouteCopperGeometry(route).viaSpans.map(
        (via) => `${via.center.x},${via.center.y}`,
      ),
    ),
  ).size

  while (acceptedCandidateCount < maximumAcceptedMoves) {
    let bestRoutes = currentRoutes
    let bestErrors = currentErrors
    for (const error of currentErrors) {
      const escapeCandidates: Array<{
        via: { center: { x: number; y: number }; diameter: number }
        centers: Array<{ x: number; y: number }>
      }> = []
      if (error.type === "pcb_pad_pad_clearance_error") {
        const obstacle = getPadObstacle(error, srj.obstacles)
        if (!obstacle) continue
        const obstacleZLayers = getObstacleZLayers(obstacle, srj.layerCount)
        const viaSites = new Map<
          string,
          { center: { x: number; y: number }; diameter: number }
        >()
        for (const route of currentRoutes) {
          for (const via of getPipeline9RouteCopperGeometry(route).viaSpans) {
            if (
              !obstacleZLayers.some((z) => z >= via.minZ && z <= via.maxZ) ||
              getPointToObstacleDistance(via.center, obstacle) >=
                via.diameter / 2 + clearance
            ) {
              continue
            }
            viaSites.set(`${via.center.x},${via.center.y}`, {
              center: via.center,
              diameter: via.diameter,
            })
          }
        }
        const evaluatedViaSites = Array.isArray(error.__pipeline9_via_sites)
          ? error.__pipeline9_via_sites
          : []
        for (const evaluatedViaSite of evaluatedViaSites) {
          if (
            !evaluatedViaSite ||
            typeof evaluatedViaSite !== "object" ||
            !("x" in evaluatedViaSite) ||
            !("y" in evaluatedViaSite) ||
            typeof evaluatedViaSite.x !== "number" ||
            typeof evaluatedViaSite.y !== "number"
          ) {
            continue
          }
          const diameter =
            "diameter" in evaluatedViaSite &&
            typeof evaluatedViaSite.diameter === "number"
              ? evaluatedViaSite.diameter
              : srj.minViaDiameter
          if (
            getPointToObstacleDistance(evaluatedViaSite, obstacle) >=
            diameter / 2 + clearance
          ) {
            continue
          }
          viaSites.set(`${evaluatedViaSite.x},${evaluatedViaSite.y}`, {
            center: { x: evaluatedViaSite.x, y: evaluatedViaSite.y },
            diameter,
          })
        }
        for (const via of viaSites.values()) {
          escapeCandidates.push({
            via,
            centers: getEscapeCenters({
              via,
              obstacle,
              clearance,
              bounds: srj.bounds,
            }),
          })
        }
      } else if (
        error.type === "pcb_via_trace_clearance_error" ||
        (error.type === "pcb_trace_error" &&
          Array.isArray(error.pcb_via_ids) &&
          error.pcb_via_ids.length > 0)
      ) {
        const center = error.center
        if (
          !center ||
          typeof center !== "object" ||
          !("x" in center) ||
          !("y" in center) ||
          typeof center.x !== "number" ||
          typeof center.y !== "number"
        ) {
          continue
        }
        const errorCenter = { x: center.x, y: center.y }
        const evaluatedViaSite = Array.isArray(error.__pipeline9_via_sites)
          ? error.__pipeline9_via_sites.find(
              (site) =>
                site &&
                typeof site === "object" &&
                "x" in site &&
                "y" in site &&
                typeof site.x === "number" &&
                typeof site.y === "number",
            )
          : undefined
        const via =
          evaluatedViaSite &&
          typeof evaluatedViaSite === "object" &&
          "x" in evaluatedViaSite &&
          "y" in evaluatedViaSite &&
          typeof evaluatedViaSite.x === "number" &&
          typeof evaluatedViaSite.y === "number"
            ? {
                center: { x: evaluatedViaSite.x, y: evaluatedViaSite.y },
                diameter:
                  "diameter" in evaluatedViaSite &&
                  typeof evaluatedViaSite.diameter === "number"
                    ? evaluatedViaSite.diameter
                    : srj.minViaDiameter,
              }
            : currentRoutes
                .flatMap(
                  (route) => getPipeline9RouteCopperGeometry(route).viaSpans,
                )
                .find(
                  (candidate) =>
                    Math.hypot(
                      candidate.center.x - errorCenter.x,
                      candidate.center.y - errorCenter.y,
                    ) <= 1e-6,
                )
        if (!via) continue
        escapeCandidates.push({
          via,
          centers: getRadialEscapeCenters({
            via,
            clearance,
            traceWidth: srj.minTraceWidth,
            bounds: srj.bounds,
          }),
        })
      }
      for (const { via, centers } of escapeCandidates) {
        for (const center of centers) {
          attemptedCandidateCount++
          const candidateRoutes = moveSharedVia({
            routes: currentRoutes,
            from: via.center,
            to: center,
          })
          const candidateErrors = getPipeline9DrcErrors(
            drcEvaluator,
            candidateRoutes,
          )
          if (candidateErrors.length === 0) {
            return {
              routes: candidateRoutes,
              remainingErrors: [],
              attemptedCandidateCount,
              acceptedCandidateCount: acceptedCandidateCount + 1,
            }
          }
          if (isPipeline9DrcCandidateBetter(candidateErrors, bestErrors)) {
            bestRoutes = candidateRoutes
            bestErrors = candidateErrors
          }
        }
      }
    }
    if (bestRoutes === currentRoutes) break
    currentRoutes = bestRoutes
    currentErrors = bestErrors
    acceptedCandidateCount++
    if (currentErrors.length === 0) break
  }

  return {
    routes: currentRoutes,
    remainingErrors: currentErrors,
    attemptedCandidateCount,
    acceptedCandidateCount,
  }
}
