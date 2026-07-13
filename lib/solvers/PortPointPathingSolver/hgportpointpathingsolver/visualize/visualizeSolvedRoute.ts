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
    const path = solvedRoute.path
    const segments: Array<{
      pointA: { x: number; y: number; z: number }
      pointB: { x: number; y: number; z: number }
      isPrefabPortal?: boolean
      portalId?: string
    }> = []
    const firstPort = path[0]?.port
    if (firstPort) {
      segments.push({
        pointA: {
          ...solvedRoute.connection.startRegion.d.center,
          z: firstPort.d.z,
        },
        pointB: firstPort.d,
      })
    }
    for (const candidate of path) {
      if (!candidate.lastPort || !candidate.lastRegion) continue
      segments.push({
        pointA: candidate.lastPort.d,
        pointB: candidate.port.d,
        isPrefabPortal: Boolean(candidate.lastRegion.d._offBoardConnectionId),
        portalId: candidate.lastRegion.d._offBoardConnectionId,
      })
    }
    const lastPort = path[path.length - 1]?.port
    if (lastPort) {
      segments.push({
        pointA: lastPort.d,
        pointB: {
          ...solvedRoute.connection.endRegion.d.center,
          z: lastPort.d.z,
        },
      })
    }

    for (const { pointA, pointB, isPrefabPortal, portalId } of segments) {
      const sameLayer = pointA.z === pointB.z
      let strokeDash: string | undefined
      if (isPrefabPortal) {
        strokeDash = "8 5"
      } else if (sameLayer) {
        strokeDash = pointA.z === 0 ? undefined : "10 5"
      } else {
        strokeDash = "3 3 10"
      }

      const line: Line = {
        points: [
          { x: pointA.x, y: pointA.y },
          { x: pointB.x, y: pointB.y },
        ],
        strokeColor: isPrefabPortal
          ? "rgba(130, 40, 210, 0.95)"
          : connectionColor,
        strokeWidth: isPrefabPortal ? 0.25 : 0.08,
        strokeDash,
      }
      graphics.lines!.push(line)
      if (isPrefabPortal) {
        graphics.points!.push(
          {
            x: pointA.x,
            y: pointA.y,
            color: "rgba(130, 40, 210, 1)",
            label: `enter prefab portal: ${portalId}`,
          },
          {
            x: pointB.x,
            y: pointB.y,
            color: "rgba(130, 40, 210, 1)",
            label: `exit prefab portal: ${portalId}`,
          },
        )
      }
    }
  }
  return graphics
}
