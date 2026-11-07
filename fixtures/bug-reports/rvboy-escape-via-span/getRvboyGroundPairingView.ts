import type { GraphicsObject, Viewbox } from "graphics-debug"
import type { SimpleRouteJson } from "../../../lib/types"
import { renderRvboyRoutingView } from "./renderRvboyRoutingView"

export function getRvboyGroundPairingView(
  input: SimpleRouteJson,
  paired: SimpleRouteJson,
  viewbox: Viewbox,
): string {
  const pairs = paired.connections.filter((connection) =>
    connection.name.includes("source_net_0"),
  )
  const lengths = pairs.map(({ pointsToConnect: [a, b] }) =>
    Math.hypot(a!.x - b!.x, a!.y - b!.y),
  )
  const graphics: GraphicsObject = {
    coordinateSystem: "cartesian",
    rects: input.obstacles
      .filter(
        (obstacle) => !obstacle.isCopperPour && obstacle.layers.includes("top"),
      )
      .map((obstacle) => ({ ...obstacle, fill: "#e2e8f0", stroke: "none" })),
    lines: pairs.map((connection, index) => ({
      points: connection.pointsToConnect.map(({ x, y }) => ({ x, y })),
      strokeColor: lengths[index]! > 10 ? "#dc2626" : "#047857",
      strokeWidth: 0.15,
    })),
    circles: pairs.flatMap((connection) =>
      connection.pointsToConnect.map(({ x, y }) => ({
        center: { x, y },
        radius: 0.12,
        fill: "#0f172a",
      })),
    ),
  }
  return renderRvboyRoutingView(
    graphics,
    viewbox,
    "RVboy GND connection planning — identical full input",
    `Unrouted airwires: ${pairs.length} pairs; ${lengths.filter((length) => length > 10).length} longer than 10 mm; total ${Math.round(lengths.reduce((sum, length) => sum + length, 0))} mm`,
  )
}
