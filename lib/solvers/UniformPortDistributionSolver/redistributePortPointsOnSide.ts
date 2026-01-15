import { Bounds, PortPointWithSide, Side } from "./types"

export const redistributePortPointsOnSide = ({
  side,
  portPoints,
  bounds,
  sideLength,
}: {
  side: Side
  portPoints: PortPointWithSide[]
  bounds: Bounds
  sideLength: number
}): PortPointWithSide[] => {
  if (portPoints.length === 0) return []

  const portsByZ = new Map<number, PortPointWithSide[]>()
  for (const port of portPoints) {
    const existing = portsByZ.get(port.z) ?? []
    existing.push(port)
    portsByZ.set(port.z, existing)
  }

  const redistributed: PortPointWithSide[] = []

  for (const [_z, portsOnZ] of portsByZ) {
    const count = portsOnZ.length
    for (let i = 0; i < count; i++) {
      const fraction = (2 * i + 1) / (2 * count)
      let x = 0,
        y = 0
      switch (side) {
        case "top":
          x = bounds.minX + sideLength * fraction
          y = bounds.maxY
          break
        case "bottom":
          x = bounds.minX + sideLength * fraction
          y = bounds.minY
          break
        case "left":
          x = bounds.minX
          y = bounds.minY + sideLength * fraction
          break
        case "right":
          x = bounds.maxX
          y = bounds.minY + sideLength * fraction
          break
      }
      redistributed.push({ ...portsOnZ[i], x, y })
    }
  }
  return redistributed
}
