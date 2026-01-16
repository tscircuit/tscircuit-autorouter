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
    const z = port.z ?? 0
    const existing = portsByZ.get(z) ?? []
    existing.push(port)
    portsByZ.set(z, existing)
  }

  const redistributed: PortPointWithSide[] = []
  const zLayers = Array.from(portsByZ.keys()).sort((a, b) => a - b)

  for (const z of zLayers) {
    const portsOnZ = portsByZ.get(z)!
    const count = portsOnZ.length

    // Sort ports by their original position to maintain relative order and prevent crossings
    portsOnZ.sort((a, b) => {
      if (side === "top" || side === "bottom") {
        return a.x - b.x
      }
      return a.y - b.y
    })

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
