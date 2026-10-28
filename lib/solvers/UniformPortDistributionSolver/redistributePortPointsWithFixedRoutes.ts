import type { HighDensityRoute } from "lib/types/high-density-types"
import { getFixedRouteBlockedIntervals } from "./getFixedRouteBlockedIntervals"
import { redistributePortPointsOnSharedEdge } from "./redistributePortPointsOnSharedEdge"
import type { PortPointWithOwnerPair, SharedEdge } from "./types"

export type FixedCopperPortDistributionInput = {
  routes: ReadonlyArray<HighDensityRoute>
  netByConnectionName: ReadonlyMap<string, string>
  traceWidthByConnectionName: ReadonlyMap<string, number>
  clearance: number
}

type Interval = { start: number; end: number }
type AllocatedPort = {
  point: PortPointWithOwnerPair
  netId: string
  width: number
  normalOffset: number
  hasFixedRestriction: boolean
  intervals: Interval[]
  target: number
}

/** Keep physical copper fixed while placing ordered foreign crossings in free space. */
export const redistributePortPointsWithFixedRoutes = (input: {
  sharedEdge: SharedEdge
  portPoints: PortPointWithOwnerPair[]
  movablePortIds: ReadonlySet<string>
  fixedCopper: FixedCopperPortDistributionInput
}): PortPointWithOwnerPair[] => {
  const { sharedEdge, fixedCopper } = input
  if (!Number.isFinite(fixedCopper.clearance) || fixedCopper.clearance < 0) {
    throw new Error("Fixed-copper port distribution requires finite nonnegative clearance")
  }
  const byLayer = new Map<number, PortPointWithOwnerPair[]>()
  for (const point of input.portPoints) {
    const layerPoints = byLayer.get(point.z) ?? []
    layerPoints.push(point)
    byLayer.set(point.z, layerPoints)
  }
  const output: PortPointWithOwnerPair[] = []
  const blockedByProfile = new Map<string, Interval[]>()
  for (const [z, points] of byLayer) {
    const alongEdge = (point: PortPointWithOwnerPair): number =>
      sharedEdge.orientation === "horizontal" ? point.x - sharedEdge.x1 : point.y - sharedEdge.y1
    points.sort((a, b) => alongEdge(a) - alongEdge(b))
    const ports: AllocatedPort[] = points.map((point, index) => {
      const netId = fixedCopper.netByConnectionName.get(point.connectionName) ??
        (point.rootConnectionName === undefined ? undefined : fixedCopper.netByConnectionName.get(point.rootConnectionName))
      if (netId === undefined) throw new Error(`Port "${point.portPointId}" has no canonical net for fixed-copper distribution`)
      const width = fixedCopper.traceWidthByConnectionName.get(point.connectionName)
      if (width === undefined || !Number.isFinite(width) || width <= 0) {
        throw new Error(`Port "${point.portPointId}" has no finite positive copper width`)
      }
      const movable = point.portPointId !== undefined && input.movablePortIds.has(point.portPointId)
      const normalOffset = movable ? 0 : sharedEdge.orientation === "horizontal" ? point.y - sharedEdge.y1 : point.x - sharedEdge.x1
      const profileKey = JSON.stringify([z, netId, width, normalOffset])
      let blocked = blockedByProfile.get(profileKey)
      if (!blocked) {
        const physicalEdge = movable ? sharedEdge : {
          ...sharedEdge,
          ...(sharedEdge.orientation === "horizontal" ? { y1: point.y, y2: point.y } : { x1: point.x, x2: point.x }),
        }
        blocked = getFixedRouteBlockedIntervals({
          sharedEdge: physicalEdge, fixedRoutes: fixedCopper.routes, z, netId, traceWidth: width,
          clearance: fixedCopper.clearance, netByConnectionName: fixedCopper.netByConnectionName,
        })
        blockedByProfile.set(profileKey, blocked)
      }
      const intervals: Interval[] = []
      let start = 0
      for (const interval of blocked) {
        if (interval.end <= start) continue
        if (interval.start >= start && start <= sharedEdge.length) {
          intervals.push({ start, end: Math.min(interval.start, sharedEdge.length) })
        }
        start = Math.max(start, interval.end)
        if (start > sharedEdge.length) break
      }
      if (start <= sharedEdge.length) intervals.push({ start, end: sharedEdge.length })
      if (!movable) {
        const position = alongEdge(point)
        const allowed = intervals.some((interval) => position >= interval.start && position <= interval.end)
        return { point, netId, width, normalOffset, hasFixedRestriction: blocked.length > 0,
          intervals: allowed ? [{ start: position, end: position }] : [], target: position }
      }
      return { point, netId, width, normalOffset, hasFixedRestriction: blocked.length > 0,
        intervals, target: sharedEdge.length * (2 * index + 1) / (2 * points.length) }
    })
    if (!ports.some((port) => port.hasFixedRestriction)) {
      // Unoccupied layers keep their existing distribution policy. Physical
      // clearance allocation applies only where foreign fixed copper is present.
      output.push(...redistributePortPointsOnSharedEdge({
        sharedEdge, portPoints: points.filter((point) => point.portPointId !== undefined && input.movablePortIds.has(point.portPointId)),
      }))
      output.push(...points.filter((point) => point.portPointId === undefined || !input.movablePortIds.has(point.portPointId)))
      continue
    }
    for (const port of ports) {
      if (port.intervals.length === 0 && (!port.point.portPointId || !input.movablePortIds.has(port.point.portPointId))) {
        throw new Error(`Fixed-copper port allocation on edge "${sharedEdge.ownerPairKey}" layer ${z} cannot preserve immutable port "${port.point.portPointId}"`)
      }
    }
    const separation = (left: AllocatedPort, right: AllocatedPort): number => {
      if (left.netId === right.netId) return 0
      const required = (left.width + right.width) / 2 + fixedCopper.clearance
      const normalDistance = Math.abs(left.normalOffset - right.normalOffset)
      return normalDistance >= required ? 0 : Math.sqrt((required - normalDistance) * (required + normalDistance))
    }
    const earliest: number[] = []
    for (let index = 0; index < ports.length; index++) {
      const port = ports[index]!
      let minimum = 0
      for (let previous = 0; previous < index; previous++) {
        minimum = Math.max(minimum, earliest[previous]! + separation(ports[previous]!, port))
      }
      const interval = port.intervals.find((candidate) => candidate.end >= minimum)
      if (!interval) {
        throw new Error(`Fixed-copper port allocation on edge "${sharedEdge.ownerPairKey}" layer ${z} has no space for port "${port.point.portPointId}"`)
      }
      earliest.push(Math.max(minimum, interval.start))
    }
    const latest: number[] = Array(ports.length)
    for (let index = ports.length - 1; index >= 0; index--) {
      const port = ports[index]!
      let maximum = sharedEdge.length
      for (let next = index + 1; next < ports.length; next++) {
        maximum = Math.min(maximum, latest[next]! - separation(port, ports[next]!))
      }
      const interval = port.intervals.findLast((candidate) => candidate.start <= maximum)
      if (!interval) throw new Error(`Fixed-copper port allocation lost a feasible suffix on edge "${sharedEdge.ownerPairKey}" layer ${z}`)
      latest[index] = Math.min(maximum, interval.end)
    }
    const positions: number[] = []
    for (let index = 0; index < ports.length; index++) {
      const port = ports[index]!
      let minimum = 0
      for (let previous = 0; previous < index; previous++) {
        minimum = Math.max(minimum, positions[previous]! + separation(ports[previous]!, port))
      }
      let best: number | undefined
      for (const interval of port.intervals) {
        const start = Math.max(interval.start, minimum)
        const end = Math.min(interval.end, latest[index]!)
        if (start > end) continue
        const position = Math.max(start, Math.min(port.target, end))
        if (best === undefined || Math.abs(position - port.target) < Math.abs(best - port.target)) best = position
      }
      if (best === undefined) throw new Error(`Fixed-copper port allocation lost a feasible position on edge "${sharedEdge.ownerPairKey}" layer ${z}`)
      positions.push(best)
      if (!port.point.portPointId || !input.movablePortIds.has(port.point.portPointId)) {
        output.push(port.point)
      } else {
        output.push({ ...port.point,
          x: sharedEdge.orientation === "horizontal" ? sharedEdge.x1 + best : sharedEdge.x1,
          y: sharedEdge.orientation === "horizontal" ? sharedEdge.y1 : sharedEdge.y1 + best,
        })
      }
    }
  }
  return output
}
