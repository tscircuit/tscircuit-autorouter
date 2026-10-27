import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

type DrillId = string

export type A64DrillPadOverlap = {
  connectionName: string
  padId: string
  x: number
  y: number
  overlapDepthMm: number
  sameNet: boolean
}

/** Check drill disks directly against source pad circles and rectangles. */
export function getA64Byte0DrillPadOverlaps({
  inputSrj,
  routedTraces,
}: {
  inputSrj: SimpleRouteJson
  routedTraces: SimplifiedPcbTrace[]
}): A64DrillPadOverlap[] {
  if (inputSrj.allowBlindAndBuriedVias) {
    throw new Error("The A64 reference uses through vias only")
  }
  const pads = inputSrj.obstacles.filter(
    (obstacle) =>
      !obstacle.isNonPlatedHole &&
      !obstacle.isCopperPour &&
      obstacle.layers.length === 1 &&
      ["top", "bottom"].includes(obstacle.layers[0]!),
  )
  const seenDrills = new Set<DrillId>()
  const overlaps: A64DrillPadOverlap[] = []
  for (const trace of routedTraces) {
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const holeDiameter =
        point.via_hole_diameter ?? inputSrj.minViaHoleDiameter
      if (holeDiameter === undefined) {
        throw new Error("A64 via has no declared drill diameter")
      }
      const drillId = `${point.x},${point.y},${holeDiameter}`
      if (seenDrills.has(drillId)) continue
      seenDrills.add(drillId)
      for (const pad of pads) {
        if (!pad.obstacleId) throw new Error("A64 pad has no source identity")
        const dx = point.x - pad.center.x
        const dy = point.y - pad.center.y
        let distanceToPad: number
        if (pad.shape === "circle") {
          distanceToPad = Math.max(0, Math.hypot(dx, dy) - pad.width / 2)
        } else {
          const angle = ((pad.ccwRotationDegrees ?? 0) * Math.PI) / 180
          const localX = dx * Math.cos(angle) + dy * Math.sin(angle)
          const localY = -dx * Math.sin(angle) + dy * Math.cos(angle)
          distanceToPad = Math.hypot(
            Math.max(0, Math.abs(localX) - pad.width / 2),
            Math.max(0, Math.abs(localY) - pad.height / 2),
          )
        }
        const overlapDepthMm = holeDiameter / 2 - distanceToPad
        if (overlapDepthMm <= 1e-7) continue
        overlaps.push({
          connectionName: trace.connection_name,
          padId: pad.obstacleId,
          x: point.x,
          y: point.y,
          overlapDepthMm,
          sameNet: pad.connectedTo.includes(trace.connection_name),
        })
      }
    }
  }
  return overlaps
}
