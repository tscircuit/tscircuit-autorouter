import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

export type Pipeline9HighDensitySeamSide = {
  routeIndex: number
  route: HighDensityRoute
  node: NodeWithPortPoints
  reversed: boolean
}

export type Pipeline9HighDensitySeamForceCandidate = {
  replacements: [
    { routeIndex: number; route: HighDensityRoute },
    { routeIndex: number; route: HighDensityRoute },
  ]
  seam: {
    portPointId: string
    connectionName: string
    ownerNodeIds: [string, string]
    x: number
    y: number
    z: number
  }
}

/** Reverse point order while keeping directional metadata on its segment. */
export const reversePipeline9HighDensitySeamRoutePoints = (
  points: RoutePoint[],
): RoutePoint[] => {
  const reversed = [...points].reverse().map((point): RoutePoint => {
    const {
      traceThickness,
      toNextSegmentType,
      toNextSegmentCircuitJsonMetadata,
      ...pointMetadata
    } = point
    return pointMetadata
  })
  for (let index = 0; index < points.length - 1; index += 1) {
    const original = points[index]!
    const reversedStart = reversed[points.length - index - 2]!
    if (original.traceThickness !== undefined) {
      reversedStart.traceThickness = original.traceThickness
    }
    if (original.toNextSegmentType !== undefined) {
      reversedStart.toNextSegmentType = original.toNextSegmentType
    }
    if (original.toNextSegmentCircuitJsonMetadata !== undefined) {
      reversedStart.toNextSegmentCircuitJsonMetadata =
        original.toNextSegmentCircuitJsonMetadata
    }
  }
  // A terminal's width is also used when attaching a terminal via. The last
  // reversed point has no outgoing segment, so retain that endpoint's width.
  if (points[0]?.traceThickness !== undefined) {
    reversed[reversed.length - 1]!.traceThickness = points[0].traceThickness
  }
  return reversed
}

const isPointInsideNode = (
  point: RoutePoint,
  node: NodeWithPortPoints,
): boolean => {
  return (
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isInteger(point.z) &&
    point.x >= node.center.x - node.width / 2 &&
    point.x <= node.center.x + node.width / 2 &&
    point.y >= node.center.y - node.height / 2 &&
    point.y <= node.center.y + node.height / 2 &&
    (node.availableZ === undefined || node.availableZ.includes(point.z))
  )
}

/** Only a unique planar crossing can preserve both original node fragments. */
export const splitPipeline9HighDensitySeamRoute = ({
  candidateRoute,
  sides,
  sharedEdge,
  portPoint,
}: {
  candidateRoute: HighDensityRoute
  sides: [Pipeline9HighDensitySeamSide, Pipeline9HighDensitySeamSide]
  sharedEdge: SharedEdge
  portPoint: PortPoint & { portPointId: string }
}): Pipeline9HighDensitySeamForceCandidate | null => {
  const axis = sharedEdge.orientation === "vertical" ? "x" : "y"
  const tangent = axis === "x" ? "y" : "x"
  const boundary = axis === "x" ? sharedEdge.x1 : sharedEdge.y1
  const tangentMin = axis === "x" ? sharedEdge.y1 : sharedEdge.x1
  const tangentMax = axis === "x" ? sharedEdge.y2 : sharedEdge.x2
  if (candidateRoute.vias.some((via) => via[axis] === boundary)) return null
  const points = candidateRoute.route
  let crossing:
    | { point: RoutePoint; beforeIndex: number; afterIndex: number }
    | undefined
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!
    const next = points[index + 1]
    if (point[axis] === boundary) {
      const previous = points[index - 1]
      if (
        !previous ||
        !next ||
        (previous[axis] - boundary) * (next[axis] - boundary) >= 0 ||
        previous.z !== point.z ||
        next.z !== point.z ||
        previous.toNextSegmentType !== undefined ||
        point.toNextSegmentType !== undefined ||
        point.toNextSegmentCircuitJsonMetadata !== undefined ||
        point.pcb_port_id !== undefined ||
        point.insideJumperPad ||
        crossing !== undefined
      ) {
        return null
      }
      crossing = {
        point: { ...point },
        beforeIndex: index - 1,
        afterIndex: index + 1,
      }
    } else if (next && (point[axis] - boundary) * (next[axis] - boundary) < 0) {
      if (
        crossing !== undefined ||
        point.z !== next.z ||
        point.toNextSegmentType !== undefined ||
        point.toNextSegmentCircuitJsonMetadata !== undefined
      ) {
        return null
      }
      const fraction = (boundary - point[axis]) / (next[axis] - point[axis])
      crossing = {
        point: {
          x: point.x + (next.x - point.x) * fraction,
          y: point.y + (next.y - point.y) * fraction,
          z: point.z,
          ...(point.traceThickness === undefined
            ? {}
            : { traceThickness: point.traceThickness }),
          [axis]: boundary,
        },
        beforeIndex: index,
        afterIndex: index + 1,
      }
    }
  }
  if (
    crossing === undefined ||
    crossing.point.z !== portPoint.z ||
    crossing.point[tangent] <= tangentMin ||
    crossing.point[tangent] >= tangentMax
  ) {
    return null
  }
  const splitPoints = [
    [...points.slice(0, crossing.beforeIndex + 1), { ...crossing.point }],
    [{ ...crossing.point }, ...points.slice(crossing.afterIndex)],
  ]
  const replacements: Pipeline9HighDensitySeamForceCandidate["replacements"] =
    sides.map((side, index) => {
      const routePoints = side.reversed
        ? reversePipeline9HighDensitySeamRoutePoints(splitPoints[index]!)
        : splitPoints[index]!.map((point) => ({ ...point }))
      return {
        routeIndex: side.routeIndex,
        route: {
          ...side.route,
          route: routePoints,
          vias: candidateRoute.vias
            .filter((via) =>
              routePoints.some(
                (point) => point.x === via.x && point.y === via.y,
              ),
            )
            .map((via) => ({ ...via })),
        },
      }
    }) as Pipeline9HighDensitySeamForceCandidate["replacements"]
  for (const [index, replacement] of replacements.entries()) {
    const side = sides[index]!
    if (
      replacement.route.route.length < 2 ||
      replacement.route.route.some(
        (point) => !isPointInsideNode(point, side.node),
      )
    ) {
      return null
    }
    const outerIndex = (index === 0) !== side.reversed ? 0 : -1
    const originalOuter = side.route.route.at(outerIndex)!
    const replacementOuter = replacement.route.route.at(outerIndex)!
    if (
      originalOuter.x !== replacementOuter.x ||
      originalOuter.y !== replacementOuter.y ||
      originalOuter.z !== replacementOuter.z ||
      originalOuter.pcb_port_id !== replacementOuter.pcb_port_id
    ) {
      return null
    }
    const replacementOuterIndex =
      outerIndex === 0 ? 0 : replacement.route.route.length - 1
    // Reversal assigns outgoing widths, including the temporary outer point.
    // Restore the original terminal metadata after returning to route order.
    replacement.route.route[replacementOuterIndex] = { ...originalOuter }
    for (const point of side.route.route) {
      const isInternalSeam =
        point[axis] === boundary &&
        point[tangent] > tangentMin &&
        point[tangent] < tangentMax
      const isNodeBoundary =
        point.x === side.node.center.x - side.node.width / 2 ||
        point.x === side.node.center.x + side.node.width / 2 ||
        point.y === side.node.center.y - side.node.height / 2 ||
        point.y === side.node.center.y + side.node.height / 2
      if (
        !isInternalSeam &&
        isNodeBoundary &&
        !replacement.route.route.some(
          (candidate) =>
            candidate.x === point.x &&
            candidate.y === point.y &&
            candidate.z === point.z,
        )
      ) {
        return null
      }
    }
  }
  return {
    replacements,
    seam: {
      portPointId: portPoint.portPointId,
      connectionName: portPoint.connectionName,
      ownerNodeIds: sharedEdge.ownerNodeIds,
      x: crossing.point.x,
      y: crossing.point.y,
      z: crossing.point.z,
    },
  }
}
