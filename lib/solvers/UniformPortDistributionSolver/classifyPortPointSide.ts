import { PortPoint } from "lib/types/high-density-types"
import { Bounds, Side } from "./types"

export const classifyPortPointSide = ({
  portPoint,
  bounds,
}: {
  portPoint: PortPoint
  bounds: Bounds
}): Side | null => {
  const tolerance = 0.001
  const isOnTop = Math.abs(portPoint.y - bounds.maxY) < tolerance
  const isOnBottom = Math.abs(portPoint.y - bounds.minY) < tolerance
  const isOnLeft = Math.abs(portPoint.x - bounds.minX) < tolerance
  const isOnRight = Math.abs(portPoint.x - bounds.maxX) < tolerance

  const sides = [
    { side: "top" as const, active: isOnTop },
    { side: "bottom" as const, active: isOnBottom },
    { side: "left" as const, active: isOnLeft },
    { side: "right" as const, active: isOnRight },
  ].filter((s) => s.active)

  return sides.length === 1 ? sides[0].side : null
}
