import type { GraphicsObject, Line } from "graphics-debug"
import type { SolvedRoutesHg } from "../types"

/** Draws solved connection paths for debug rendering. */
export function visualizeSolvedRoute(
  solvedRoutes: SolvedRoutesHg[],
  colorMap: Record<string, string>,
): GraphicsObject {
  const graphics: GraphicsObject = {
    lines: [],
    points: [],
  }

  for (const solvedRoute of solvedRoutes) {
    const connectionColor =
      colorMap[solvedRoute.connection.connectionId] ?? "rgba(255, 50, 50, 1)"
    const segmentPoints: Array<{ x: number; y: number; z: number }> = [
      {
        x: solvedRoute.connection.startRegion.d.center.x,
        y: solvedRoute.connection.startRegion.d.center.y,
        z: solvedRoute.connection.startRegion.d?.availableZ?.[0] ?? 0,
      },
    ]
    for (const candidate of solvedRoute.path) {
      segmentPoints.push({
        x: candidate.port.d.x,
        y: candidate.port.d.y,
        z: candidate.port.d.z,
      })
    }
    segmentPoints.push({
      x: solvedRoute.connection.endRegion.d.center.x,
      y: solvedRoute.connection.endRegion.d.center.y,
      z: solvedRoute.connection.endRegion.d?.availableZ?.[0] ?? 0,
    })

    for (let i = 0; i < segmentPoints.length - 1; i++) {
      const pointA = segmentPoints[i]
      const pointB = segmentPoints[i + 1]
      const sameLayer = pointA.z === pointB.z
      let strokeDash: string | undefined
      if (sameLayer) {
        strokeDash = pointA.z === 0 ? undefined : "10 5"
      } else {
        strokeDash = "3 3 10"
      }

      const line: Line = {
        points: [
          { x: pointA.x, y: pointA.y },
          { x: pointB.x, y: pointB.y },
        ],
        strokeColor: connectionColor,
        strokeWidth: 0.1,
        strokeDash,
      }
      graphics.lines!.push(line)
    }
  }
  return graphics
}
