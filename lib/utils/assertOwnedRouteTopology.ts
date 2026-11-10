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
import { isLocalRouteViaContact } from "./isLocalRouteViaContact"
import { DSU } from "./dsu"
import { trimSegmentAtTerminal } from "./trimSegmentAtTerminal"
import { DifferentialPairRoutingError } from "./DifferentialPairRoutingError"

type Point = { x: number; y: number }
type Segment = {
  a: Point
  b: Point
  z: number
  width: number
  routeIndex: number
  segmentIndex: number
  pathStartIndex?: number
  isVia?: boolean
}

/** Fail closed on shared copper outside declared terminals, including tap bypasses. */
export const assertOwnedRouteTopology = (
  input: {
    differentialPairs: DifferentialPair[]
    connections: SimpleRouteConnection[]
    obstacles: Obstacle[]
    layerCount: number
  },
  routes: HighDensityRoute[],
): void => {
  const ownedNames = new Set(
    input.differentialPairs.flatMap((pair): string[] =>
      pair.connectionNames.flat(),
    ),
  )
  if (ownedNames.size === 0) return
  const failOwnership = (connectionName: string, message: string): never => {
    const pairIndex = input.differentialPairs.findIndex((pair): boolean =>
      pair.connectionNames.flat().includes(connectionName),
    )
    if (pairIndex < 0)
      throw new Error(
        `Ownership diagnostic has no pair for "${connectionName}"`,
      )
    throw new DifferentialPairRoutingError(
      { reason: "ownership_violation", pairIndex, connectionName },
      message,
    )
  }
  const segments: Segment[] = routes.flatMap((route, routeIndex): Segment[] =>
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
            pathStartIndex: index,
          },
        ]
      })
      .map((segment, segmentIndex): Segment => ({ ...segment, segmentIndex })),
  )
  for (const [routeIndex, route] of routes.entries()) {
    const seenVias = new Set<string>()
    for (const via of route.vias) {
      const key = `${via.x},${via.y}`
      if (seenVias.has(key)) continue
      seenVias.add(key)
      for (let z = 0; z < input.layerCount; z++) {
        segments.push({
          a: via,
          b: via,
          z,
          width: route.viaDiameter,
          routeIndex,
          segmentIndex: -1,
          isVia: true,
        })
      }
    }
  }
  const ordinaryRouteIndexes = routes.flatMap((route, index): string[] =>
    ownedNames.has(route.connectionName) ? [] : [String(index)],
  )
  const ordinaryComponents = new DSU(ordinaryRouteIndexes)
  for (const [index, first] of segments.entries()) {
    const firstRoute = routes[first.routeIndex]!
    for (const second of segments.slice(index + 1)) {
      const secondRoute = routes[second.routeIndex]!
      if (first.z !== second.z) continue
      if (
        !ownedNames.has(firstRoute.connectionName) &&
        !ownedNames.has(secondRoute.connectionName)
      ) {
        if (
          doSegmentsIntersect(first.a, first.b, second.a, second.b) ||
          Math.min(
            pointToSegmentDistance(first.a, second.a, second.b),
            pointToSegmentDistance(first.b, second.a, second.b),
            pointToSegmentDistance(second.a, first.a, first.b),
            pointToSegmentDistance(second.b, first.a, first.b),
          ) <
            (first.width + second.width) / 2
        )
          ordinaryComponents.union(
            String(first.routeIndex),
            String(second.routeIndex),
          )
        continue
      }
      if (
        first.routeIndex === second.routeIndex &&
        !first.isVia &&
        !second.isVia &&
        Math.abs(first.segmentIndex - second.segmentIndex) <= 1
      ) {
        const dx1 = first.b.x - first.a.x
        const dy1 = first.b.y - first.a.y
        const dx2 = second.b.x - second.a.x
        const dy2 = second.b.y - second.a.y
        if (
          Math.abs(dx1 * dy2 - dy1 * dx2) <= 1e-8 &&
          dx1 * dx2 + dy1 * dy2 < -1e-8
        )
          failOwnership(
            firstRoute.connectionName,
            `ownership violation: "${firstRoute.connectionName}" retraces its own copper`,
          )
        continue
      }
      if (
        first.routeIndex === second.routeIndex &&
        (first.isVia || second.isVia)
      ) {
        const via = first.isVia ? first : second
        const wire = first.isVia ? second : first
        if (
          !wire.isVia &&
          isLocalRouteViaContact(
            firstRoute,
            via.a,
            wire.pathStartIndex!,
            (via.width + wire.width) / 2,
          )
        )
          continue
      }
      const ownedConnection = input.connections.find(
        (connection): boolean =>
          connection.name ===
          (ownedNames.has(firstRoute.connectionName)
            ? firstRoute.connectionName
            : secondRoute.connectionName),
      )
      if (!ownedConnection)
        return failOwnership(
          ownedNames.has(firstRoute.connectionName)
            ? firstRoute.connectionName
            : secondRoute.connectionName,
          "owned route has no connection declaration",
        )
      const sharedTerminals =
        first.routeIndex === second.routeIndex
          ? []
          : ownedConnection.pointsToConnect.filter((terminal): boolean =>
              [firstRoute, secondRoute].every((route): boolean =>
                [route.route[0]!, route.route.at(-1)!].some(
                  (point): boolean =>
                    Math.hypot(point.x - terminal.x, point.y - terminal.y) <=
                    1e-8,
                ),
              ),
            )
      let firstSegment: [Point, Point] | null = [first.a, first.b]
      let secondSegment: [Point, Point] | null = [second.a, second.b]
      // Use the pad's inscribed circle, or the trace junction for virtual terminals.
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
        const radius = pad
          ? Math.min(pad.width, pad.height) / 2
          : Math.max(first.width, second.width) / 2
        if (firstSegment)
          firstSegment = trimSegmentAtTerminal(firstSegment, terminal, radius)
        if (secondSegment)
          secondSegment = trimSegmentAtTerminal(secondSegment, terminal, radius)
      }
      if (!firstSegment || !secondSegment) continue
      const [a, b] = firstSegment
      const [c, d] = secondSegment
      const distance = doSegmentsIntersect(a, b, c, d)
        ? 0
        : Math.min(
            pointToSegmentDistance(a, c, d),
            pointToSegmentDistance(b, c, d),
            pointToSegmentDistance(c, a, b),
            pointToSegmentDistance(d, a, b),
          )
      if (
        first.routeIndex === second.routeIndex && !first.isVia && !second.isVia
          ? distance <= 1e-8
          : distance < (first.width + second.width) / 2 - 1e-8
      )
        failOwnership(
          ownedNames.has(firstRoute.connectionName)
            ? firstRoute.connectionName
            : secondRoute.connectionName,
          `ownership violation: "${firstRoute.connectionName}" and "${secondRoute.connectionName}" share copper outside a declared terminal`,
        )
    }
  }
  // An ordinary connected component can attach once to the owned path. Two
  // distinct attachments create a bypass even if neither lies inside a hop.
  const terminals = input.connections
    .filter((connection): boolean => ownedNames.has(connection.name))
    .flatMap(
      (connection): SimpleRouteConnection["pointsToConnect"] =>
        connection.pointsToConnect,
    )
  const attachments = new Map<string, Set<string>>()
  const endpointOwners = new Map<string, string>()
  for (const routeIndex of ordinaryRouteIndexes) {
    const route = routes[Number(routeIndex)]!
    for (const point of [route.route[0]!, route.route.at(-1)!]) {
      const key = `${point.x},${point.y},${point.z}`
      const previousOwner = endpointOwners.get(key)
      if (previousOwner) ordinaryComponents.union(routeIndex, previousOwner)
      endpointOwners.set(key, routeIndex)
    }
  }
  for (const routeIndex of ordinaryRouteIndexes) {
    const route = routes[Number(routeIndex)]!
    const component = ordinaryComponents.find(routeIndex)
    let attached = attachments.get(component)
    if (!attached) {
      attached = new Set()
      attachments.set(component, attached)
    }
    for (const terminal of terminals) {
      if (
        [route.route[0]!, route.route.at(-1)!].some(
          (point): boolean =>
            Math.hypot(point.x - terminal.x, point.y - terminal.y) <= 1e-8,
        )
      )
        attached.add(
          terminal.pointId ??
            terminal.pcb_port_id ??
            `${terminal.x},${terminal.y}`,
        )
    }
    if (attached.size > 1)
      failOwnership(
        input.connections.find(
          (connection): boolean =>
            ownedNames.has(connection.name) &&
            connection.pointsToConnect.some((point): boolean =>
              attached!.has(
                point.pointId ?? point.pcb_port_id ?? `${point.x},${point.y}`,
              ),
            ),
        )!.name,
        `ownership violation: ordinary copper "${route.connectionName}" bypasses owned terminals`,
      )
  }
}
