import type { GraphicsObject, Viewbox } from "graphics-debug"
import type { SimpleRouteJson } from "../../../lib/types"
import { renderRvboyRoutingView } from "./renderRvboyRoutingView"

export function getRvboyPourPairingView(
  input: SimpleRouteJson,
  paired: SimpleRouteJson,
  viewbox: Viewbox,
): string {
  const pairs = paired.connections.filter((connection) =>
    connection.name.includes("source_net_0"),
  )
  const joinsEscapeVias = pairs.map((connection) =>
    connection.pointsToConnect.every((point) =>
      point.pointId?.startsWith("escape-via:"),
    ),
  )
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: input.obstacles
      .filter(
        (obstacle) => obstacle.isCopperPour || obstacle.layers.includes("top"),
      )
      .map((obstacle) => ({
        ...obstacle,
        fill: obstacle.isCopperPour ? "none" : "#e2e8f0",
        stroke: obstacle.isCopperPour ? "#dcfce7" : "none",
      })),
    lines: pairs.map((connection, index) => ({
      points: connection.pointsToConnect.map(({ x, y }) => ({ x, y })),
      strokeColor: joinsEscapeVias[index] ? "#dc2626" : "#047857",
      strokeWidth: 0.15,
    })),
    circles: pairs.flatMap((connection) =>
      connection.pointsToConnect.map((point) => ({
        center: { x: point.x, y: point.y },
        radius: point.pointId?.startsWith("escape-via:") ? 0.225 : 0.12,
        fill: point.pointId?.startsWith("escape-via:") ? "#2563eb" : "#0f172a",
      })),
    ),
  }
  return renderRvboyRoutingView(
    graphics,
    viewbox,
    "RVboy GND island planning — identical full input",
    `Unrouted airwires: ${pairs.length} pairs; ${joinsEscapeVias.filter(Boolean).length} links between vias on the same ground plane (red)`,
  )
}
