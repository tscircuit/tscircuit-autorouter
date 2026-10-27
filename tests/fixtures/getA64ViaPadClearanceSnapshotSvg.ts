import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getGraphicsLayerForObstacle } from "lib/utils/getGraphicsObjectLayer"
import { isPointInRect } from "lib/utils/isPointInRect"

/** Crop the drawing only; draw source circular pads with their actual radius. */
export function getA64ViaPadClearanceSnapshotSvg({
  inputSrj,
  routedTraces,
  viaPadErrorCount,
}: {
  inputSrj: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
  viaPadErrorCount: number
}): string {
  const view = { center: { x: 130.6, y: -85.1 }, width: 4.6, height: 3.4 }
  const graphics = convertSrjToGraphicsObject({
    ...inputSrj,
    obstacles: [],
    traces: routedTraces,
  })
  graphics.points = []
  graphics.lines = graphics.lines.flatMap((line) =>
    line.points.slice(0, -1).flatMap((point, index) => {
      const next = line.points[index + 1]!
      return isPointInRect(point, view) && isPointInRect(next, view)
        ? [{ ...line, points: [point, next] }]
        : []
    }),
  )
  graphics.circles = graphics.circles.filter((circle) =>
    isPointInRect(circle.center, view),
  )
  for (const obstacle of inputSrj.obstacles) {
    if (obstacle.isCopperPour || !isPointInRect(obstacle.center, view)) continue
    const common = {
      center: obstacle.center,
      fill: "rgba(220,38,38,0.35)",
      layer: getGraphicsLayerForObstacle(obstacle, inputSrj.layerCount),
      label: obstacle.obstacleId,
    }
    if (obstacle.shape === "circle") {
      graphics.circles.push({ ...common, radius: obstacle.width / 2 })
    } else {
      graphics.rects.push({
        ...common,
        width: obstacle.width,
        height: obstacle.height,
        ccwRotationDegrees: obstacle.ccwRotationDegrees,
      })
    }
  }
  const svg = getSvgFromGraphicsObject(graphics, { backgroundColor: "white" })
  const color = viaPadErrorCount === 0 ? "#166534" : "#b91c1c"
  const minimum = inputSrj.minViaEdgeToPadEdgeClearance ?? inputSrj.defaultObstacleMargin
  const legend = `<g><rect x="12" y="12" width="580" height="92" rx="6" fill="white" stroke="${color}"/><text x="24" y="38" font-family="Arial,sans-serif" font-size="18" fill="${color}">A64 CPU to DDR: via copper / pad clearance</text><text x="24" y="64" font-family="Arial,sans-serif" font-size="18" fill="${color}">Violations: ${viaPadErrorCount}; source minimum: ${minimum} mm</text><text x="24" y="90" font-family="Arial,sans-serif" font-size="16" fill="#334155">Whole input: ${inputSrj.connections.length} signals, ${inputSrj.obstacles.length} obstacles</text></g>`
  return svg.replace("</svg>", `${legend}</svg>`)
}
