import {
  doSegmentsIntersect,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import type {
  DifferentialPair,
  SimpleRouteConnection,
  Obstacle,
} from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { DifferentialPairRoutingError } from "./DifferentialPairRoutingError"

type Point = { x: number; y: number }
type Segment = {
  a: Point
  b: Point
  z: number
  width: number
  routeIndex: number
  segmentIndex: number
}

/** Fail closed on shared copper outside declared terminals, including tap bypasses. */
export const assertOwnedRouteTopology = (
  input: {
    differentialPairs: DifferentialPair[]
    connections: SimpleRouteConnection[]
    obstacles: Obstacle[]
  },
  routes: HighDensityRoute[],
): void => {
  const ownedNames = new Set(
    input.differentialPairs.flatMap((pair) => pair.connectionNames.flat()),
  )
  if (ownedNames.size === 0) return
  const segments: Segment[] = routes.flatMap((route, routeIndex) =>
    route.route
      .slice(1)
      .flatMap((point, index): Segment[] => {
        const previous = route.route[index]!
        if (
          point.z !== previous.z ||
          Math.hypot(point.x - previous.x, point.y - previous.y) <= 1e-8
        )
          return []
        return [
          {
            a: previous,
            b: point,
            z: point.z,
            width: Math.max(
              previous.traceThickness ?? route.traceThickness,
              point.traceThickness ?? route.traceThickness,
            ),
            routeIndex,
            segmentIndex: index,
          },
        ]
      })
      .map((segment, segmentIndex): Segment => ({ ...segment, segmentIndex })),
  )
  for (const [index, first] of segments.entries()) {
    const firstRoute = routes[first.routeIndex]!
    for (const second of segments.slice(index + 1)) {
      const secondRoute = routes[second.routeIndex]!
      if (
        (!ownedNames.has(firstRoute.connectionName) &&
          !ownedNames.has(secondRoute.connectionName)) ||
        first.z !== second.z
      )
        continue
      if (
        first.routeIndex === second.routeIndex &&
        Math.abs(first.segmentIndex - second.segmentIndex) <= 1
      )
        continue
      const firstConnection = input.connections.find(
        (connection): boolean => connection.name === firstRoute.connectionName,
      )
      const secondConnection = input.connections.find(
        (connection): boolean => connection.name === secondRoute.connectionName,
      )
      const sharedTerminals =
        first.routeIndex === second.routeIndex
          ? []
          : (firstConnection?.pointsToConnect ?? []).filter((point): boolean =>
              (secondConnection?.pointsToConnect ?? []).some(
                (other): boolean =>
                  Math.hypot(point.x - other.x, point.y - other.y) <= 1e-8 &&
                  (point.pointId !== undefined
                    ? point.pointId === other.pointId
                    : point.pcb_port_id !== undefined &&
                      point.pcb_port_id === other.pcb_port_id),
              ),
            )
      let a = first.a
      let b = first.b
      let c = second.a
      let d = second.b
      // Trim only within a shared pad's inscribed circle. Contacts elsewhere
      // would let an adjacent hop or an ordinary branch bypass the itinerary.
      for (const terminal of sharedTerminals) {
        const pad = input.obstacles.find(
          (obstacle): boolean =>
            terminal.pcb_port_id !== undefined &&
            obstacle.connectedTo.includes(terminal.pcb_port_id) &&
            Math.hypot(
              obstacle.center.x - terminal.x,
              obstacle.center.y - terminal.y,
            ) <= 1e-8,
        )
        const radius = pad ? Math.min(pad.width, pad.height) / 2 : 1e-8
        const trim = (start: Point, end: Point): Point => {
          const distance = Math.hypot(end.x - start.x, end.y - start.y)
          if (
            Math.hypot(start.x - terminal.x, start.y - terminal.y) > radius ||
            distance <= 1e-8
          )
            return start
          const amount = Math.min(
            1,
            (radius + Math.max(first.width, second.width)) / distance,
          )
          return {
            x: start.x + (end.x - start.x) * amount,
            y: start.y + (end.y - start.y) * amount,
          }
        }
        a = trim(a, b)
        b = trim(b, a)
        c = trim(c, d)
        d = trim(d, c)
      }
      if (
        Math.hypot(a.x - b.x, a.y - b.y) <= 1e-8 ||
        Math.hypot(c.x - d.x, c.y - d.y) <= 1e-8
      )
        continue
      const distance = doSegmentsIntersect(a, b, c, d)
        ? 0
        : Math.min(
            pointToSegmentDistance(a, c, d),
            pointToSegmentDistance(b, c, d),
            pointToSegmentDistance(c, a, b),
            pointToSegmentDistance(d, a, b),
          )
      if (
        first.routeIndex === second.routeIndex
          ? distance <= 1e-8
          : distance < (first.width + second.width) / 2 - 1e-8
      )
        throw new DifferentialPairRoutingError(
          `ownership violation: "${firstRoute.connectionName}" and "${secondRoute.connectionName}" share copper outside a declared terminal`,
        )
    }
  }
}
