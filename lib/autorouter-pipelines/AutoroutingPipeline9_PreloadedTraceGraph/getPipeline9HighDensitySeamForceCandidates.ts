import { getSharedEdgeForNodePair } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import {
  getPipeline9HighDensityForceCandidates,
  type Pipeline9HighDensityForceCandidateParams,
} from "./getPipeline9HighDensityForceCandidates"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9BoundsOverlap,
  getPipeline9FixedRouteObstacles,
  getPipeline9RouteCopperBounds,
  getPipeline9RouteCopperGeometry,
  type Pipeline9Bounds,
} from "./pipeline9FixedRouteCopper"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"
import {
  type Pipeline9HighDensitySeamForceCandidate,
  type Pipeline9HighDensitySeamSide,
  reversePipeline9HighDensitySeamRoutePoints,
  splitPipeline9HighDensitySeamRoute,
} from "./splitPipeline9HighDensitySeamRoute"

export type { Pipeline9HighDensitySeamForceCandidate } from "./splitPipeline9HighDensitySeamRoute"

type RoutePoint = HighDensityRoute["route"][number]
type SeamPortPoint = PortPoint & { portPointId: string }
type SeamNeighborhood = {
  sides: [Pipeline9HighDensitySeamSide, Pipeline9HighDensitySeamSide]
  portPoint: SeamPortPoint
  sharedEdge: SharedEdge
}

export type Pipeline9HighDensitySeamForceCandidateParams = Omit<
  Pipeline9HighDensityForceCandidateParams,
  "node"
> & {
  affectedRouteIndex: number
  nodePortPoints: NodeWithPortPoints[]
  fixedHdRoutes: HighDensityRoute[]
}

const pointsMatch = (left: RoutePoint, right: RoutePoint): boolean => {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.z === right.z
  )
}

const getNodeBounds = (node: NodeWithPortPoints): Pipeline9Bounds => {
  return {
    minX: node.center.x - node.width / 2,
    maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2,
    maxY: node.center.y + node.height / 2,
  }
}

const hasProtectedSeamEndpoint = (
  route: HighDensityRoute,
  endpointIndex: number,
): boolean => {
  const point = route.route[endpointIndex]!
  const previous = route.route[endpointIndex - 1]
  return (
    point.pcb_port_id !== undefined ||
    point.insideJumperPad === true ||
    point.toNextSegmentType !== undefined ||
    point.toNextSegmentCircuitJsonMetadata !== undefined ||
    previous?.toNextSegmentType !== undefined ||
    (endpointIndex === 0
      ? route.startPcbPortId !== undefined
      : route.endPcbPortId !== undefined)
  )
}

const matchesUniqueTopologyPair = (
  side: Pipeline9HighDensitySeamSide,
  portPoint: SeamPortPoint,
): boolean => {
  const matchingPairs = side.node.portPointsInPairs?.filter((pair) =>
    pair.some(
      (point) =>
        point.portPointId === portPoint.portPointId &&
        point.connectionName === portPoint.connectionName,
    ),
  )
  if (matchingPairs?.length !== 1) return false
  const [start, end] = matchingPairs[0]!
  const routeStart = side.route.route[0]!
  const routeEnd = side.route.route.at(-1)!
  return (
    start.connectionName === portPoint.connectionName &&
    end.connectionName === portPoint.connectionName &&
    ((pointsMatch(start, routeStart) && pointsMatch(end, routeEnd)) ||
      (pointsMatch(start, routeEnd) && pointsMatch(end, routeStart)))
  )
}

const getSeamNeighborhoods = (
  params: Pipeline9HighDensitySeamForceCandidateParams,
): SeamNeighborhood[] => {
  const affected = params.hdRoutes[params.affectedRouteIndex]
  const ownedIndexes = new Set(params.traceRouteIndexById.values())
  if (!affected || !ownedIndexes.has(params.affectedRouteIndex)) {
    throw new Error("Pipeline9 seam repair requires an owned route index")
  }
  const node = params.nodePortPoints.find(
    (candidate) => candidate.capacityMeshNodeId === affected.regionId,
  )
  if (!node) {
    throw new Error("Pipeline9 seam repair requires the route's current node")
  }
  const neighborhoods: SeamNeighborhood[] = []
  for (const endpointIndex of [0, affected.route.length - 1]) {
    const endpoint = affected.route[endpointIndex]
    if (!endpoint || hasProtectedSeamEndpoint(affected, endpointIndex)) {
      continue
    }
    const ports = node.portPoints.filter(
      (point) =>
        point.connectionName === affected.connectionName &&
        pointsMatch(point, endpoint),
    )
    if (
      ports.length !== 1 ||
      ports[0]!.portPointId === undefined ||
      ports[0]!.pcb_port_id !== undefined
    ) {
      continue
    }
    const portPoint = ports[0] as SeamPortPoint
    const owners = params.nodePortPoints.filter((candidate) =>
      candidate.portPoints.some(
        (point) => point.portPointId === portPoint.portPointId,
      ),
    )
    if (owners.length !== 2 || owners[0] === owners[1]) continue
    if (
      owners.some(
        (owner) =>
          owner.portPoints.filter(
            (point) => point.portPointId === portPoint.portPointId,
          ).length !== 1 ||
          owner.portPoints.some(
            (point) =>
              pointsMatch(point, endpoint) &&
              (point.portPointId !== portPoint.portPointId ||
                point.connectionName !== portPoint.connectionName ||
                point.pcb_port_id !== undefined),
          ),
      )
    ) {
      continue
    }
    const peerNode = owners.find(
      (owner) => owner.capacityMeshNodeId !== node.capacityMeshNodeId,
    )
    if (!peerNode) continue
    const matchingEndpoints = params.hdRoutes.flatMap((route, routeIndex) =>
      [0, route.route.length - 1].flatMap((index) =>
        route.route[index] && pointsMatch(route.route[index]!, endpoint)
          ? [{ routeIndex, endpointIndex: index, route }]
          : [],
      ),
    )
    if (matchingEndpoints.length !== 2) continue
    const peer = matchingEndpoints.find(
      (entry) => entry.routeIndex !== params.affectedRouteIndex,
    )
    if (
      !peer ||
      !ownedIndexes.has(peer.routeIndex) ||
      peer.route.regionId !== peerNode.capacityMeshNodeId ||
      peer.route.connectionName !== affected.connectionName ||
      peer.route.traceThickness !== affected.traceThickness ||
      peer.route.viaDiameter !== affected.viaDiameter ||
      hasProtectedSeamEndpoint(peer.route, peer.endpointIndex)
    ) {
      continue
    }
    const nodeBounds = getNodeBounds(node)
    const peerBounds = getNodeBounds(peerNode)
    if (
      nodeBounds.maxX !== peerBounds.minX &&
      peerBounds.maxX !== nodeBounds.minX &&
      nodeBounds.maxY !== peerBounds.minY &&
      peerBounds.maxY !== nodeBounds.minY
    ) {
      continue
    }
    const sharedEdge = getSharedEdgeForNodePair({
      nodeAId: node.capacityMeshNodeId,
      nodeBId: peerNode.capacityMeshNodeId,
      nodeBounds: new Map([
        [node.capacityMeshNodeId, nodeBounds],
        [peerNode.capacityMeshNodeId, peerBounds],
      ]),
    })
    if (!sharedEdge) continue
    const axis = sharedEdge.orientation === "vertical" ? "x" : "y"
    const tangent = axis === "x" ? "y" : "x"
    const boundary = axis === "x" ? sharedEdge.x1 : sharedEdge.y1
    const tangentMin = axis === "x" ? sharedEdge.y1 : sharedEdge.x1
    const tangentMax = axis === "x" ? sharedEdge.y2 : sharedEdge.x2
    if (
      endpoint[axis] !== boundary ||
      endpoint[tangent] <= tangentMin ||
      endpoint[tangent] >= tangentMax ||
      [affected, peer.route].some(
        (route) =>
          route.vias.some((via) => via[axis] === boundary) ||
          route.route.some(
            (point, index) =>
              point[axis] === boundary &&
              route.route[index + 1]?.z !== undefined &&
              point.z !== route.route[index + 1]!.z,
          ),
      )
    ) {
      continue
    }
    const sides: SeamNeighborhood["sides"] = [
      {
        routeIndex: params.affectedRouteIndex,
        route: affected,
        node,
        reversed: endpointIndex === 0,
      },
      {
        routeIndex: peer.routeIndex,
        route: peer.route,
        node: peerNode,
        reversed: peer.endpointIndex !== 0,
      },
    ]
    if (!sides.every((side) => matchesUniqueTopologyPair(side, portPoint))) {
      continue
    }
    const immutableRoutes = [
      ...params.hdRoutes.filter(
        (_, index) =>
          index !== params.affectedRouteIndex && index !== peer.routeIndex,
      ),
      ...params.fixedHdRoutes,
    ]
    const touchesSameNetBranch = immutableRoutes.some((route) => {
      if (!arePipeline9RoutesOnSameNet(affected, route, params.connMap)) {
        return false
      }
      const geometry = getPipeline9RouteCopperGeometry(route)
      return (
        geometry.wireSegments.some(
          (segment) =>
            segment.z === endpoint.z &&
            minimumDistanceBetweenSegments(
              endpoint,
              endpoint,
              segment.start,
              segment.end,
            ) <=
              segment.width / 2 + affected.traceThickness / 2,
        ) ||
        geometry.viaSpans.some(
          (via) =>
            endpoint.z >= via.minZ &&
            endpoint.z <= via.maxZ &&
            Math.hypot(endpoint.x - via.center.x, endpoint.y - via.center.y) <=
              via.diameter / 2 + affected.traceThickness / 2,
        )
      )
    })
    if (touchesSameNetBranch) continue
    neighborhoods.push({ sides, portPoint, sharedEdge })
  }
  return neighborhoods
}

const getCompositeErrors = (
  errors: Pipeline9DrcError[],
  traceIds: ReadonlySet<string>,
  compositeTraceId: string,
): Pipeline9DrcError[] => {
  return errors.map((error) => {
    const normalized = { ...error }
    for (const field of ["pcb_trace_id", "__trace_segment_owner_trace_id"]) {
      const identity = error[field]
      if (typeof identity === "string" && traceIds.has(identity)) {
        normalized[field] = compositeTraceId
      }
    }
    for (const field of ["pcb_trace_ids", "__via_owner_trace_ids"]) {
      const identities = error[field]
      if (!Array.isArray(identities)) continue
      normalized[field] = [
        ...new Set(
          identities.map((identity) =>
            typeof identity === "string" && traceIds.has(identity)
              ? compositeTraceId
              : identity,
          ),
        ),
      ]
    }
    const prefix = `overlap_${error.pcb_trace_id}_`
    if (
      typeof error.pcb_trace_error_id === "string" &&
      error.pcb_trace_error_id.startsWith(prefix)
    ) {
      const other = error.pcb_trace_error_id.slice(prefix.length)
      normalized.pcb_trace_error_id = `overlap_${normalized.pcb_trace_id}_${
        traceIds.has(other) ? compositeTraceId : other
      }`
    }
    return normalized
  })
}

/** Repairs only two owned fragments joined by one structural HD handoff. */
export function* getPipeline9HighDensitySeamForceCandidates(
  params: Pipeline9HighDensitySeamForceCandidateParams,
): Generator<Pipeline9HighDensitySeamForceCandidate, void, unknown> {
  for (const neighborhood of getSeamNeighborhoods(params)) {
    const { sides, portPoint, sharedEdge } = neighborhood
    const orientedPoints = sides.map((side) =>
      side.reversed
        ? reversePipeline9HighDensitySeamRoutePoints(side.route.route)
        : side.route.route.map((point) => ({ ...point })),
    )
    const composite: HighDensityRoute = {
      ...sides[0].route,
      route: [...orientedPoints[0]!.slice(0, -1), ...orientedPoints[1]!],
      vias: sides.flatMap((side) => side.route.vias.map((via) => ({ ...via }))),
      jumpers: sides.flatMap((side) => side.route.jumpers ?? []),
      startPcbPortId: sides[0].reversed
        ? sides[0].route.endPcbPortId
        : sides[0].route.startPcbPortId,
      endPcbPortId: sides[1].reversed
        ? sides[1].route.startPcbPortId
        : sides[1].route.endPcbPortId,
    }
    const boundsA = getNodeBounds(sides[0].node)
    const boundsB = getNodeBounds(sides[1].node)
    const bounds = {
      minX: Math.min(boundsA.minX, boundsB.minX),
      maxX: Math.max(boundsA.maxX, boundsB.maxX),
      minY: Math.min(boundsA.minY, boundsB.minY),
      maxY: Math.max(boundsA.maxY, boundsB.maxY),
    }
    const pairIndexes = new Set(sides.map((side) => side.routeIndex))
    const traceIds = new Set(
      [...params.traceRouteIndexById].flatMap(([traceId, routeIndex]) =>
        pairIndexes.has(routeIndex) ? [traceId] : [],
      ),
    )
    const compositeTraceId = [...traceIds][0]!
    const padding = composite.viaDiameter / 2 + params.obstacleMargin
    const nearbyBounds = {
      minX: bounds.minX - padding,
      maxX: bounds.maxX + padding,
      minY: bounds.minY - padding,
      maxY: bounds.maxY + padding,
    }
    const immutableRoutes = [
      ...params.hdRoutes.filter((_, index) => !pairIndexes.has(index)),
      ...params.fixedHdRoutes,
    ].filter((route) => {
      const copperBounds = getPipeline9RouteCopperBounds(route)
      return (
        copperBounds !== undefined &&
        doPipeline9BoundsOverlap(nearbyBounds, copperBounds)
      )
    })
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: `pipeline9-seam-${portPoint.portPointId}`,
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      },
      width: bounds.maxX - bounds.minX,
      height: bounds.maxY - bounds.minY,
      portPoints: [],
    }
    for (const candidates of getPipeline9HighDensityForceCandidates({
      ...params,
      node,
      hdRoutes: [composite],
      errors: getCompositeErrors(params.errors, traceIds, compositeTraceId),
      traceRouteIndexById: new Map([...traceIds].map((traceId) => [traceId, 0])),
      obstacles: [
        ...params.obstacles,
        ...getPipeline9FixedRouteObstacles({
          fixedObstacleRoutes: immutableRoutes,
          layerCount: params.layerCount,
        }),
      ],
    })) {
      const split = splitPipeline9HighDensitySeamRoute({
        candidateRoute: candidates[0]!,
        sides,
        sharedEdge,
        portPoint,
      })
      if (split) yield split
      else params.onCandidateRejected?.("geometry")
    }
  }
}
