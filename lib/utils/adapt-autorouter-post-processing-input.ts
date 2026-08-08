import type { PostProcessingSolverParams } from "@tscircuit/length-matching-solver"

type PostProcessingObstacle = PostProcessingSolverParams["obstacles"][number]
type PostProcessingHdRoute = PostProcessingSolverParams["hdRoutes"][number]
type PostProcessingBoundaryInput = Pick<
  PostProcessingSolverParams,
  "hdRoutes" | "obstacles"
>

function normalizePostProcessingObstacles(
  obstacles: PostProcessingObstacle[],
): PostProcessingObstacle[] {
  return obstacles.map((obstacle) => {
    const obstacleType = (obstacle as { type: string }).type
    if (obstacleType !== "oval") return obstacle

    return {
      ...obstacle,
      type: "rect",
    }
  })
}

function normalizePostProcessingHdRoutes(
  hdRoutes: PostProcessingHdRoute[],
): PostProcessingHdRoute[] {
  return hdRoutes.map((hdRoute) => {
    const route = hdRoute.route.map((point, pointIndex, points) => {
      const nextPoint = points[pointIndex + 1]
      if (
        point.toNextSegmentType !== "through_obstacle" ||
        !nextPoint ||
        point.z !== nextPoint.z
      ) {
        return { ...point }
      }

      const normalizedPoint = { ...point }
      delete normalizedPoint.toNextSegmentType
      return normalizedPoint
    })
    const vias: PostProcessingHdRoute["vias"] = []
    for (let pointIndex = 0; pointIndex < route.length - 1; pointIndex++) {
      const point = route[pointIndex]!
      const nextPoint = route[pointIndex + 1]!
      if (point.z === nextPoint.z) continue
      if (point.toNextSegmentType === "through_obstacle") continue
      const zLayers: number[] = []
      const firstLayer = Math.min(point.z, nextPoint.z)
      const lastLayer = Math.max(point.z, nextPoint.z)
      for (let layer = firstLayer; layer <= lastLayer; layer++)
        zLayers.push(layer)
      vias.push({ x: point.x, y: point.y, zLayers })
    }

    return {
      ...hdRoute,
      route,
      vias,
    }
  })
}

/** Normalizes valid autorouter output immediately before post-processing. */
export function adaptAutorouterPostProcessingInput<
  Input extends PostProcessingBoundaryInput,
>(input: Input): Input {
  return {
    ...input,
    hdRoutes: normalizePostProcessingHdRoutes(input.hdRoutes),
    obstacles: normalizePostProcessingObstacles(input.obstacles),
  }
}
