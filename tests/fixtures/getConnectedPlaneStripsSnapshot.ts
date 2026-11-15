import type { GraphicsObject } from "graphics-debug"
import type { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import { getGraphicsLayerForObstacle } from "lib/utils/getGraphicsObjectLayer"

/** Routing requests in board-world mm (+X right, +Y up), using the solver's
 * actual pad, plane and escape-via geometry. Blue lines are pending routes.
 */
export function getConnectedPlaneStripsSnapshot(
  solver: NetToPointPairsSolver,
): GraphicsObject {
  const input = solver.ogSrj
  const graphics = solver.visualize()
  const vias = input.obstacles.filter((obstacle) =>
    obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
  )
  return {
    ...graphics,
    title: "Connected plane strip routing requests",
    points: [],
    lines: graphics.lines?.map((line) => ({
      ...line,
      strokeWidth: input.minTraceWidth,
    })),
    rects: input.obstacles
      .filter((obstacle) => !vias.includes(obstacle))
      .map((obstacle) => ({
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: obstacle.isCopperPour ? "rgba(22,163,74,0.16)" : "#fca5a5",
        stroke: obstacle.isCopperPour ? "#86b99b" : "#b91c1c",
        layer: getGraphicsLayerForObstacle(obstacle, input.layerCount),
        label: obstacle.isCopperPour ? "GND plane (inner1)" : "Pad (top)",
      })),
    circles: vias.map((via) => ({
      center: via.center,
      radius: via.width / 2,
      fill: "#93c5fd",
      stroke: "#1d4ed8",
      layer: getGraphicsLayerForObstacle(via, input.layerCount),
      label: "Through via to GND plane",
    })),
    texts: [
      {
        x: 0,
        y: 3.1,
        text: `${solver.newConnections.length} routing requests`,
        fontSize: 0.35,
        anchorSide: "center",
      },
      {
        x: 0,
        y: -2.85,
        text: "Same pads, vias and touching GND strips. Blue lines = pending routes.",
        fontSize: 0.18,
        anchorSide: "center",
      },
    ],
  }
}
