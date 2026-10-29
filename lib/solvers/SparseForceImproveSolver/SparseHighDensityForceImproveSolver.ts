// Vendored from tscircuit/high-density-repair01@27b3392c38ed4474b0557c73640b261155e28c27.
// Copyright (c) 2026 tscircuit. MIT; see SparseHighDensityForceImproveSolver.LICENSE.
// Only sparse kernel work elimination and its counters differ from that source;
// the native class projection/topology/output behavior remains unchanged.
import Flatbush from "flatbush"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "high-density-repair01/lib/BaseSolver"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "high-density-repair01/lib/types/high-density-types"
import { safeTransparentize } from "high-density-repair01/lib/utils/colors"
import {
  areSameXY,
  deriveVias,
  getCoincidentPointIndexes,
  getInsetNodeBounds,
  getRouteRootConnectionName,
} from "high-density-repair01/lib/utils/force-improve-route-helpers"
import {
  collectProjectionSegments,
  getProjectionSegmentDistanceCandidates,
  type ProjectionSegment,
  pointToProjectionSegment,
} from "high-density-repair01/lib/utils/force-improve-segment-helpers"
import { getVectorLength } from "high-density-repair01/lib/utils/getVectorLength"
import {
  findAlignedTopologyCandidate,
  findNewProperSegmentCrossings,
  preconditionRoutesForNewCrossings,
} from "high-density-repair01/lib/utils/high-density-force-improve-topology"

type Vector = {
  x: number
  y: number
}

type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

type MutableNode = {
  x: number
  y: number
  originalX: number
  originalY: number
  boundaryPadding: number
  pointIndexes: number[]
  fixed: boolean
  forceIndex: number
}

type MutableRoute = {
  route: HighDensityRoute
  rootConnectionName: string
  nodes: MutableNode[]
  pointNodeIndexes: Int32Array
}

type ForceElementBase = {
  routeIndex: number
  rootConnectionName: string
  node: MutableNode
  fixed: boolean
}

type PointForceElement = ForceElementBase & {
  kind: "point"
  z: number
}

type ViaForceElement = ForceElementBase & {
  kind: "via"
}

type ForceElement = PointForceElement | ViaForceElement

type SegmentObstacle = {
  obstacleIndex: number
  rootConnectionName: string
  z: number
  startNode: MutableNode
  endNode: MutableNode
}

type SegmentSpatialLayerIndex = {
  index: Flatbush
  segments: SegmentObstacle[]
}

type SegmentSpatialIndex = {
  byLayer: Map<number, SegmentSpatialLayerIndex>
}

type SegmentSpatialIndexCache = {
  segments: SegmentObstacle[]
  index: SegmentSpatialIndex | null
  stats?: SparseForceStats
  reuseStats?: SparseForceIndexReuseStats
}

type ForceImproveSampleEntry = {
  node: NodeWithPortPoints
  routeIndexes: number[]
}

type ProjectionViaNode = {
  routeIndex: number
  rootConnectionName: string
  pointIndexes: number[]
  x: number
  y: number
  radius: number
  movable: boolean
}

export type ForceVector = {
  kind: "point" | "via"
  routeIndex: number
  rootConnectionName: string
  x: number
  y: number
  dx: number
  dy: number
}

export type ForceImproveResult = {
  routes: HighDensityRoute[]
  forceVectors: ForceVector[]
  stepsCompleted: number
}

export type SparseForceStats = {
  activated: boolean
  sampleNodes: number
  kernelCalls: number
  allFixedCalls: number
  fixedNodeCount: number
  mutableNodeCount: number
  requestedForceSteps: number
  executedForceSteps: number
  skippedForceSteps: number
  noWritePairsSkipped: number
  fixedClampVisitsSkipped: number
  projectionPassesExecuted: number
  projectionPassesSkipped: number
  inactiveProjectionExits: number
  spatialIndexBuilds: number
  inactiveProjectionPassesSkipped: number
}

export const createSparseForceStats = (): SparseForceStats => ({
  activated: false,
  sampleNodes: 0,
  kernelCalls: 0,
  allFixedCalls: 0,
  fixedNodeCount: 0,
  mutableNodeCount: 0,
  requestedForceSteps: 0,
  executedForceSteps: 0,
  skippedForceSteps: 0,
  noWritePairsSkipped: 0,
  fixedClampVisitsSkipped: 0,
  projectionPassesExecuted: 0,
  projectionPassesSkipped: 0,
  inactiveProjectionExits: 0,
  spatialIndexBuilds: 0,
  inactiveProjectionPassesSkipped: 0,
})

export type ForceImproveOptions = {
  includeForceVectors?: boolean
  stats?: SparseForceStats
  indexReuseStats?: SparseForceIndexReuseStats
}

export type SparseForceIndexReuseStats = {
  kernelCachesCreated: number
  indexRequests: number
  indexReuses: number
  indexInvalidations: number
  nodeCoordinateChanges: number
  clampCoordinateChanges: number
}

export const createSparseForceIndexReuseStats = (): SparseForceIndexReuseStats => ({
  kernelCachesCreated: 0,
  indexRequests: 0,
  indexReuses: 0,
  indexInvalidations: 0,
  nodeCoordinateChanges: 0,
  clampCoordinateChanges: 0,
})

// The first and last trace segments encode pad escape/arrival geometry.
const isPointOnProtectedEndpointSegment = (
  routeLength: number,
  index: number,
) => index <= 1 || index >= routeLength - 2

const includesProtectedEndpointSegmentPoint = (
  routeLength: number,
  pointIndexes: number[],
) =>
  pointIndexes.some((pointIndex) =>
    isPointOnProtectedEndpointSegment(routeLength, pointIndex),
  )

const TARGET_CLEARANCE = 0.2
const CLEARANCE_FALLOFF_DISTANCE = 0.4
const VIA_DIAMETER = 0.3
const VIA_RADIUS = VIA_DIAMETER / 2
const POINT_SEGMENT_TARGET_CLEARANCE = 0.25
const POINT_SEGMENT_FALLOFF_DISTANCE = 0.5
const VIA_SEGMENT_TARGET_CLEARANCE = VIA_RADIUS + 0.25
const VIA_SEGMENT_FALLOFF_DISTANCE = 0.5
const VIA_BORDER_EXTRA_CLEARANCE = 0.15
const VIA_BORDER_TARGET_CLEARANCE =
  VIA_SEGMENT_TARGET_CLEARANCE + VIA_BORDER_EXTRA_CLEARANCE + 0.1
const VIA_BORDER_FALLOFF_DISTANCE = VIA_BORDER_TARGET_CLEARANCE + 0.05
const VIA_VIA_REPULSION_STRENGTH = 0.034
const VIA_SEGMENT_REPULSION_STRENGTH = 0.18
const POINT_SEGMENT_REPULSION_STRENGTH = 0.06
const REPULSION_TAIL_RATIO = 0.08
const REPULSION_FALLOFF = 18
const INTERSECTION_FORCE_BOOST = 3.5
const VIA_SEGMENT_INTERSECTION_FORCE_BOOST = 12
const BORDER_REPULSION_STRENGTH = 0.03
const BORDER_REPULSION_TAIL_RATIO = 0.08
const BORDER_REPULSION_FALLOFF = 20
const VIA_BORDER_REPULSION_TAIL_RATIO = 0.015
const VIA_BORDER_REPULSION_FALLOFF = 80
const SHAPE_RESTORE_STRENGTH = 0.14
const PATH_SMOOTHING_STRENGTH = 0.22
const TIGHTENING_FORCE_STRENGTH = 0.55
const MAX_TIGHTENING_MOVE_PER_STEP = 0.02
const END_SEGMENT_ORTHOGONAL_FORCE_STRENGTH = 1.1
const MAX_END_SEGMENT_ORTHOGONAL_MOVE_PER_STEP = 0.06
const CLEARANCE_PROJECTION_RATIO = 0.9
const POINT_SEGMENT_CLEARANCE_PROJECTION_RATIO = 1.05
const VIA_SEGMENT_CLEARANCE_PROJECTION_RATIO = 1.35
const CLEARANCE_PROJECTION_PASSES = 3
const MAX_CLEARANCE_CORRECTION = 0.02
const VIA_SEGMENT_MAX_CLEARANCE_CORRECTION_MULTIPLIER = 3
const FINAL_CLEARANCE_PROJECTION_PASSES = 8
const FINAL_MAX_CLEARANCE_CORRECTION = 0.03
const STEP_SIZE = 0.85
const MAX_NODE_MOVE_PER_STEP = 0.012
const MIN_STEP_DECAY = 0.25
const FORCE_VECTOR_DISPLAY_MULTIPLIER = 5
const DEFAULT_ASSIGNMENT_MARGIN = 0.2
const DEFAULT_TOTAL_STEPS_PER_NODE = 60

const ROUNDING_PRECISION = 1_000
const POSITION_EPSILON = 1e-6
const COORDINATE_MATCH_EPSILON = 1e-3
const BOUNDARY_INSET = 1 / ROUNDING_PRECISION
const RELAXED_VIA_CLEARANCE = 0.1
const RELAXED_TRACE_CLEARANCE = 0.1
const CLEARANCE_SLACK = 0.015
const VIA_PROJECTION_PASSES = 10
const MAX_VIA_MOVE_PER_PASS = 0.04
const MAX_TRACE_MOVE_PER_PASS = 0.025

const roundCoordinate = (value: number) =>
  Math.round(value * ROUNDING_PRECISION) / ROUNDING_PRECISION

const subtractVector = (left: Vector, right: Vector): Vector => ({
  x: left.x - right.x,
  y: left.y - right.y,
})

const scaleVector = (vector: Vector, scale: number): Vector => ({
  x: vector.x * scale,
  y: vector.y * scale,
})

const dotVector = (left: Vector, right: Vector) =>
  left.x * right.x + left.y * right.y

const lerpVector = (start: Vector, end: Vector, t: number): Vector => ({
  x: start.x + (end.x - start.x) * t,
  y: start.y + (end.y - start.y) * t,
})

const clampUnitInterval = (value: number) => Math.max(0, Math.min(value, 1))

const clampValue = (value: number, minValue: number, maxValue: number) =>
  Math.max(minValue, Math.min(value, maxValue))

const isOutsideExpandedBounds = (
  pointX: number,
  pointY: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  expansion: number,
) =>
  pointX < minX - expansion ||
  pointX > maxX + expansion ||
  pointY < minY - expansion ||
  pointY > maxY + expansion

const getVectorMagnitude = (vector: Vector) =>
  getVectorLength(vector.x, vector.y)

const clampVectorMagnitude = (vector: Vector, maxMagnitude: number) => {
  const magnitude = getVectorMagnitude(vector)
  if (magnitude <= maxMagnitude || magnitude <= POSITION_EPSILON) {
    return vector
  }

  return scaleVector(vector, maxMagnitude / magnitude)
}

const getNodeBounds = (node: NodeWithPortPoints, margin = 0): Bounds => ({
  minX: node.center.x - node.width / 2 - margin,
  maxX: node.center.x + node.width / 2 + margin,
  minY: node.center.y - node.height / 2 - margin,
  maxY: node.center.y + node.height / 2 + margin,
})

const isPointInsideNode = (
  point: { x: number; y: number },
  node: NodeWithPortPoints,
  margin = 0,
) => {
  const bounds = getNodeBounds(node, margin)
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  )
}

const findNodeIndexForRoute = (
  route: HighDensityRoute,
  nodes: NodeWithPortPoints[],
  margin: number,
): number => {
  if (route.regionId) {
    const regionNodeIndex = nodes.findIndex(
      (node) => node.capacityMeshNodeId === route.regionId,
    )
    if (regionNodeIndex !== -1) return regionNodeIndex
  }
  const routePoints = route.route.map(({ x, y }) => ({ x, y }))
  const viaPoints = route.vias.map(({ x, y }) => ({ x, y }))
  const points = [...routePoints, ...viaPoints]
  let bestNodeIndex = -1
  let bestNodeArea = Number.POSITIVE_INFINITY

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (
      !node ||
      !points.every((point) => isPointInsideNode(point, node, margin))
    ) {
      continue
    }

    // Prefer the tightest containing node so short sub-node routes
    // are not assigned to a larger parent and collapsed by clamping.
    const nodeArea = node.width * node.height
    if (nodeArea < bestNodeArea) {
      bestNodeArea = nodeArea
      bestNodeIndex = i
    }
  }

  return bestNodeIndex
}

const getEndpointOrthogonalLockAxis = (
  endpoint: MutableNode,
  adjacentNode: MutableNode,
  bounds: Bounds,
): "x" | "y" => {
  const verticalEdgeDistance = Math.min(
    Math.abs(endpoint.originalX - bounds.minX),
    Math.abs(bounds.maxX - endpoint.originalX),
  )
  const horizontalEdgeDistance = Math.min(
    Math.abs(endpoint.originalY - bounds.minY),
    Math.abs(bounds.maxY - endpoint.originalY),
  )

  if (
    Math.abs(verticalEdgeDistance - horizontalEdgeDistance) <= POSITION_EPSILON
  ) {
    const deltaX = Math.abs(adjacentNode.x - endpoint.x)
    const deltaY = Math.abs(adjacentNode.y - endpoint.y)
    return deltaX >= deltaY ? "y" : "x"
  }

  return verticalEdgeDistance < horizontalEdgeDistance ? "y" : "x"
}

const getEndpointOrthogonalMove = (
  endpoint: MutableNode,
  adjacentNode: MutableNode,
  bounds: Bounds,
  decay: number,
): Vector => {
  const orthogonalLockAxis = getEndpointOrthogonalLockAxis(
    endpoint,
    adjacentNode,
    bounds,
  )

  if (orthogonalLockAxis === "x") {
    return clampVectorMagnitude(
      {
        x:
          (endpoint.x - adjacentNode.x) *
          END_SEGMENT_ORTHOGONAL_FORCE_STRENGTH *
          decay,
        y: 0,
      },
      MAX_END_SEGMENT_ORTHOGONAL_MOVE_PER_STEP * decay,
    )
  }

  return clampVectorMagnitude(
    {
      x: 0,
      y:
        (endpoint.y - adjacentNode.y) *
        END_SEGMENT_ORTHOGONAL_FORCE_STRENGTH *
        decay,
    },
    MAX_END_SEGMENT_ORTHOGONAL_MOVE_PER_STEP * decay,
  )
}

const getClearanceForceMagnitude = (
  distance: number,
  strength: number,
  tailRatio: number,
  falloff: number,
  intersectionBoost = INTERSECTION_FORCE_BOOST,
  targetClearance = TARGET_CLEARANCE,
  falloffDistance = CLEARANCE_FALLOFF_DISTANCE,
) => {
  const clampedDistance = Math.max(distance, 0)
  if (clampedDistance >= falloffDistance) {
    return 0
  }

  const normalizedDistance = clampedDistance / targetClearance

  if (normalizedDistance < 1) {
    const penetration = 1 - normalizedDistance
    return strength * penetration ** 3 * (1 + penetration * intersectionBoost)
  }

  const tailSpan = Math.max(falloffDistance - targetClearance, POSITION_EPSILON)
  const tailProgress = (clampedDistance - targetClearance) / tailSpan
  const tailMagnitude = strength * tailRatio * Math.exp(-tailProgress * falloff)

  return tailMagnitude < 1e-5 ? 0 : tailMagnitude
}

const clampNodeToBounds = (node: MutableNode, bounds: Bounds) => {
  const inset = node.boundaryPadding > 0 ? BOUNDARY_INSET : 0
  const minX = bounds.minX + node.boundaryPadding + inset
  const maxX = bounds.maxX - node.boundaryPadding - inset
  const minY = bounds.minY + node.boundaryPadding + inset
  const maxY = bounds.maxY - node.boundaryPadding - inset

  node.x = clampValue(node.x, minX, maxX)
  node.y = clampValue(node.y, minY, maxY)
}

const clampMutableRoutesToBounds = (
  mutableRoutes: MutableRoute[],
  bounds: Bounds,
  skipFixed = false,
  stats?: SparseForceStats,
  segmentIndexCache?: SegmentSpatialIndexCache,
) => {
  for (const mutableRoute of mutableRoutes) {
    for (const node of mutableRoute.nodes) {
      // The initial clamp is retained; subsequent fixed-node clamps are idempotent.
      if (skipFixed && node.fixed) {
        if (stats) stats.fixedClampVisitsSkipped += 1
        continue
      }
      const previousX = node.x
      const previousY = node.y
      clampNodeToBounds(node, bounds)
      if (segmentIndexCache) {
        invalidateSegmentIndexAfterNodeChange(
          segmentIndexCache, node, previousX, previousY, true,
        )
      }
    }
  }
}

const getElementTargetClearance = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_SEGMENT_TARGET_CLEARANCE
    : POINT_SEGMENT_TARGET_CLEARANCE

const getElementFalloffDistance = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_SEGMENT_FALLOFF_DISTANCE
    : POINT_SEGMENT_FALLOFF_DISTANCE

const getBorderTargetClearance = (element: ForceElement) =>
  element.kind === "via" ? VIA_BORDER_TARGET_CLEARANCE : TARGET_CLEARANCE

const getBorderFalloffDistance = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_BORDER_FALLOFF_DISTANCE
    : CLEARANCE_FALLOFF_DISTANCE

const getBorderTailRatio = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_BORDER_REPULSION_TAIL_RATIO
    : BORDER_REPULSION_TAIL_RATIO

const getBorderRepulsionFalloff = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_BORDER_REPULSION_FALLOFF
    : BORDER_REPULSION_FALLOFF

const getElementIntersectionBoost = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_SEGMENT_INTERSECTION_FORCE_BOOST
    : INTERSECTION_FORCE_BOOST

const getPointSegmentRepulsionStrength = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_SEGMENT_REPULSION_STRENGTH
    : POINT_SEGMENT_REPULSION_STRENGTH

const getProjectionRatio = (element: ForceElement) =>
  element.kind === "via"
    ? VIA_SEGMENT_CLEARANCE_PROJECTION_RATIO
    : POINT_SEGMENT_CLEARANCE_PROJECTION_RATIO

const getMaxCorrectionForElement = (
  element: ForceElement,
  maxCorrection: number,
) =>
  element.kind === "via"
    ? maxCorrection * VIA_SEGMENT_MAX_CLEARANCE_CORRECTION_MULTIPLIER
    : maxCorrection

const buildMutableRoutes = (routes: HighDensityRoute[]) => {
  let nextForceIndex = 0
  const mutableRoutes: MutableRoute[] = routes.map((route) => {
    const nodes: MutableNode[] = []
    const pointNodeIndexes = new Int32Array(route.route.length)
    pointNodeIndexes.fill(-1)

    for (let index = 0; index < route.route.length; index += 1) {
      const point = route.route[index]
      if (!point) continue

      const previousPoint = route.route[index - 1]
      const lastNode = nodes.at(-1)
      const lastNodeIndex = nodes.length - 1

      if (
        lastNode &&
        previousPoint &&
        previousPoint.x === point.x &&
        previousPoint.y === point.y
      ) {
        if (previousPoint.z !== point.z) {
          lastNode.boundaryPadding = Math.max(
            lastNode.boundaryPadding,
            route.viaDiameter / 2,
          )
        }
        lastNode.pointIndexes.push(index)
        lastNode.fixed ||= isPointOnProtectedEndpointSegment(
          route.route.length,
          index,
        )
        pointNodeIndexes[index] = lastNodeIndex
        continue
      }

      nodes.push({
        x: point.x,
        y: point.y,
        originalX: point.x,
        originalY: point.y,
        boundaryPadding: 0,
        pointIndexes: [index],
        fixed: isPointOnProtectedEndpointSegment(route.route.length, index),
        forceIndex: nextForceIndex,
      })
      pointNodeIndexes[index] = nodes.length - 1
      nextForceIndex += 1
    }

    return {
      route,
      rootConnectionName: route.rootConnectionName ?? route.connectionName,
      nodes,
      pointNodeIndexes,
    }
  })

  return {
    mutableRoutes,
    totalNodeCount: nextForceIndex,
  }
}

const buildForceElements = (routes: MutableRoute[]): ForceElement[] => {
  const elements: ForceElement[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const mutableRoute = routes[routeIndex]
    if (!mutableRoute) continue

    for (
      let nodeIndex = 0;
      nodeIndex < mutableRoute.nodes.length;
      nodeIndex += 1
    ) {
      const node = mutableRoute.nodes[nodeIndex]
      const routePointIndex = node?.pointIndexes[0]
      const routePoint =
        routePointIndex === undefined
          ? undefined
          : mutableRoute.route.route[routePointIndex]

      if (!node || !routePoint) continue

      if (node.pointIndexes.length > 1) {
        elements.push({
          kind: "via",
          routeIndex,
          rootConnectionName: mutableRoute.rootConnectionName,
          node,
          fixed: node.fixed,
        })
        continue
      }

      elements.push({
        kind: "point",
        routeIndex,
        rootConnectionName: mutableRoute.rootConnectionName,
        node,
        z: routePoint.z,
        fixed: node.fixed,
      })
    }
  }

  return elements
}

const buildSegmentObstacles = (routes: MutableRoute[]): SegmentObstacle[] => {
  const segments: SegmentObstacle[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const mutableRoute = routes[routeIndex]
    if (!mutableRoute) continue

    for (
      let nodeIndex = 0;
      nodeIndex < mutableRoute.nodes.length - 1;
      nodeIndex += 1
    ) {
      const startNode = mutableRoute.nodes[nodeIndex]
      const endNode = mutableRoute.nodes[nodeIndex + 1]
      const routePointIndex = startNode?.pointIndexes[0]
      const routePoint =
        routePointIndex === undefined
          ? undefined
          : mutableRoute.route.route[routePointIndex]

      if (!startNode || !endNode || !routePoint) continue
      segments.push({
        obstacleIndex: segments.length,
        rootConnectionName: mutableRoute.rootConnectionName,
        z: routePoint.z,
        startNode,
        endNode,
      })
    }
  }

  return segments
}

const addForceToNode = (
  nodeForces: Float64Array,
  forceIndex: number,
  forceX: number,
  forceY: number,
) => {
  const forceOffset = forceIndex * 2
  nodeForces[forceOffset] = (nodeForces[forceOffset] ?? 0) + forceX
  nodeForces[forceOffset + 1] = (nodeForces[forceOffset + 1] ?? 0) + forceY
}

const applyForceToElement = (
  element: ForceElement,
  forceX: number,
  forceY: number,
  nodeForces: Float64Array,
  elementForces?: Float64Array,
  elementIndex?: number,
) => {
  if (!element.fixed) {
    addForceToNode(nodeForces, element.node.forceIndex, forceX, forceY)
  }

  if (!element.fixed && elementForces && elementIndex !== undefined) {
    const forceOffset = elementIndex * 2
    elementForces[forceOffset] = (elementForces[forceOffset] ?? 0) + forceX
    elementForces[forceOffset + 1] =
      (elementForces[forceOffset + 1] ?? 0) + forceY
  }
}

const distributeForceToSegmentPoints = (
  segment: SegmentObstacle,
  forceX: number,
  forceY: number,
  nodeForces: Float64Array,
  segmentT = 0.5,
) => {
  const { startNode, endNode } = segment

  const startWeight = 1 - clampUnitInterval(segmentT)
  const endWeight = clampUnitInterval(segmentT)
  const movableStartWeight = startNode.fixed ? 0 : startWeight
  const movableEndWeight = endNode.fixed ? 0 : endWeight
  const movableWeightTotal = movableStartWeight + movableEndWeight

  if (movableWeightTotal <= POSITION_EPSILON) {
    return
  }

  if (!startNode.fixed && movableStartWeight > 0) {
    const scale = movableStartWeight / movableWeightTotal
    addForceToNode(
      nodeForces,
      startNode.forceIndex,
      forceX * scale,
      forceY * scale,
    )
  }

  if (!endNode.fixed && movableEndWeight > 0) {
    const scale = movableEndWeight / movableWeightTotal
    addForceToNode(
      nodeForces,
      endNode.forceIndex,
      forceX * scale,
      forceY * scale,
    )
  }
}

const getBorderForce = (
  bounds: Bounds,
  element: ForceElement,
  elementX: number,
  elementY: number,
  stepDecay: number,
): Vector => {
  if (element.fixed) {
    return { x: 0, y: 0 }
  }

  const { minX, maxX, minY, maxY } = bounds
  const targetClearance = getBorderTargetClearance(element)
  const falloffDistance = getBorderFalloffDistance(element)
  const tailRatio = getBorderTailRatio(element)
  const borderRepulsionFalloff = getBorderRepulsionFalloff(element)
  const intersectionBoost = getElementIntersectionBoost(element)

  return {
    x:
      getClearanceForceMagnitude(
        elementX - minX,
        BORDER_REPULSION_STRENGTH,
        tailRatio,
        borderRepulsionFalloff,
        intersectionBoost,
        targetClearance,
        falloffDistance,
      ) *
        stepDecay -
      getClearanceForceMagnitude(
        maxX - elementX,
        BORDER_REPULSION_STRENGTH,
        tailRatio,
        borderRepulsionFalloff,
        intersectionBoost,
        targetClearance,
        falloffDistance,
      ) *
        stepDecay,
    y:
      getClearanceForceMagnitude(
        elementY - minY,
        BORDER_REPULSION_STRENGTH,
        tailRatio,
        borderRepulsionFalloff,
        intersectionBoost,
        targetClearance,
        falloffDistance,
      ) *
        stepDecay -
      getClearanceForceMagnitude(
        maxY - elementY,
        BORDER_REPULSION_STRENGTH,
        tailRatio,
        borderRepulsionFalloff,
        intersectionBoost,
        targetClearance,
        falloffDistance,
      ) *
        stepDecay,
  }
}

const buildSegmentSpatialLayerIndex = (
  segments: SegmentObstacle[],
): SegmentSpatialLayerIndex | null => {
  if (segments.length === 0) {
    return null
  }

  const index = new Flatbush(segments.length)
  for (const segment of segments) {
    const { startNode, endNode } = segment
    index.add(
      Math.min(startNode.x, endNode.x),
      Math.min(startNode.y, endNode.y),
      Math.max(startNode.x, endNode.x),
      Math.max(startNode.y, endNode.y),
    )
  }
  index.finish()

  return { index, segments }
}

const buildSegmentSpatialIndex = (
  segments: SegmentObstacle[],
): SegmentSpatialIndex => {
  const byLayer = new Map<number, SegmentSpatialLayerIndex>()
  const segmentsByLayer = new Map<number, SegmentObstacle[]>()

  for (const segment of segments) {
    const layerSegments = segmentsByLayer.get(segment.z) ?? []
    layerSegments.push(segment)
    segmentsByLayer.set(segment.z, layerSegments)
  }

  for (const [layer, layerSegments] of segmentsByLayer) {
    const layerIndex = buildSegmentSpatialLayerIndex(layerSegments)
    if (layerIndex) {
      byLayer.set(layer, layerIndex)
    }
  }

  return { byLayer }
}

const getCachedSegmentSpatialIndex = (
  cache: SegmentSpatialIndexCache,
): SegmentSpatialIndex => {
  if (cache.reuseStats) cache.reuseStats.indexRequests += 1
  if (cache.index !== null) {
    if (cache.reuseStats) cache.reuseStats.indexReuses += 1
    return cache.index
  }
  if (cache.stats) cache.stats.spatialIndexBuilds += 1
  cache.index = buildSegmentSpatialIndex(cache.segments)
  return cache.index
}

const invalidateSegmentIndexAfterNodeChange = (
  cache: SegmentSpatialIndexCache,
  node: MutableNode,
  previousX: number,
  previousY: number,
  isClamp = false,
): void => {
  // Once dirty, later writes cannot invalidate this tree again.
  if (cache.index === null && !cache.reuseStats) return
  if (Object.is(node.x, previousX) && Object.is(node.y, previousY)) return
  if (cache.reuseStats) {
    cache.reuseStats.nodeCoordinateChanges += 1
    if (isClamp) cache.reuseStats.clampCoordinateChanges += 1
  }
  if (cache.index !== null) {
    cache.index = null
    if (cache.reuseStats) cache.reuseStats.indexInvalidations += 1
  }
}

const getSegmentSpatialSearches = (
  segmentSpatialIndex: SegmentSpatialIndex,
  element: ForceElement,
  elementX: number,
  elementY: number,
  expansion: number,
) => {
  const searchLayerIndex = (layerIndex: SegmentSpatialLayerIndex) => ({
    candidateIndexes: layerIndex.index.search(
      elementX - expansion,
      elementY - expansion,
      elementX + expansion,
      elementY + expansion,
    ),
    segments: layerIndex.segments,
  })

  if (element.kind === "point") {
    const layerIndex = segmentSpatialIndex.byLayer.get(element.z)
    return layerIndex ? [searchLayerIndex(layerIndex)] : []
  }

  const searches: ReturnType<typeof searchLayerIndex>[] = []
  for (const layerIndex of segmentSpatialIndex.byLayer.values()) {
    searches.push(searchLayerIndex(layerIndex))
  }

  return searches
}

const materializeRoutes = (mutableRoutes: MutableRoute[]) =>
  mutableRoutes.map(({ route, nodes, pointNodeIndexes }) => {
    const nextRoutePoints = route.route.map((point, pointIndex) => {
      const ownerNodeIndex = pointNodeIndexes[pointIndex] ?? -1
      const ownerNode = ownerNodeIndex >= 0 ? nodes[ownerNodeIndex] : undefined

      return ownerNode
        ? {
            ...point,
            x: roundCoordinate(ownerNode.x),
            y: roundCoordinate(ownerNode.y),
          }
        : point
    })

    const nextRoute: HighDensityRoute = {
      ...route,
      route: nextRoutePoints,
      vias: [],
    }

    nextRoute.vias = deriveVias(nextRoute)
    return nextRoute
  })

const clampProjectionViaToNode = (
  via: ProjectionViaNode,
  node: NodeWithPortPoints,
) => {
  const bounds = getInsetNodeBounds(node, via.radius + POSITION_EPSILON)
  via.x = clampValue(via.x, bounds.minX, bounds.maxX)
  via.y = clampValue(via.y, bounds.minY, bounds.maxY)
}

const collectProjectionViaNodes = (
  routes: HighDensityRoute[],
): ProjectionViaNode[] => {
  const viaNodes: ProjectionViaNode[] = []

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex]
    if (!route) continue
    const seenPointIndexes = new Set<number>()

    for (let index = 0; index < route.route.length - 1; index += 1) {
      const current = route.route[index]
      const next = route.route[index + 1]
      if (!current || !next) continue
      if (current.z === next.z || !areSameXY(current, next)) {
        continue
      }

      const pointIndexes = [index, index + 1]
      for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) {
          break
        }
        pointIndexes.push(cursor)
      }
      for (let cursor = index + 2; cursor < route.route.length; cursor += 1) {
        const point = route.route[cursor]
        if (!point || !areSameXY(point, current)) {
          break
        }
        pointIndexes.push(cursor)
      }

      const uniquePointIndexes = [...new Set(pointIndexes)].sort(
        (a, b) => a - b,
      )
      let overlapsSeenPoint = false
      for (const pointIndex of uniquePointIndexes) {
        if (seenPointIndexes.has(pointIndex)) {
          overlapsSeenPoint = true
          break
        }
      }
      if (overlapsSeenPoint) {
        continue
      }
      for (const pointIndex of uniquePointIndexes) {
        seenPointIndexes.add(pointIndex)
      }

      viaNodes.push({
        routeIndex,
        rootConnectionName: getRouteRootConnectionName(route),
        pointIndexes: uniquePointIndexes,
        x: current.x,
        y: current.y,
        radius: (route.viaDiameter ?? VIA_DIAMETER) / 2,
        movable: !includesProtectedEndpointSegmentPoint(
          route.route.length,
          uniquePointIndexes,
        ),
      })
    }
  }

  return viaNodes
}

const applyProjectionViaMove = (params: {
  routes: HighDensityRoute[]
  via: ProjectionViaNode
  dx: number
  dy: number
  node: NodeWithPortPoints
}) => {
  const { routes, via, dx, dy, node } = params
  if (!via.movable) return false

  via.x += dx
  via.y += dy
  clampProjectionViaToNode(via, node)

  const route = routes[via.routeIndex]
  if (!route) return false
  for (const pointIndex of via.pointIndexes) {
    const point = route.route[pointIndex]
    if (!point) continue
    point.x = via.x
    point.y = via.y
  }

  return true
}

const projectViaViaClearance = (params: {
  routes: HighDensityRoute[]
  node: NodeWithPortPoints
  vias: ProjectionViaNode[]
}) => {
  const { routes, node, vias } = params
  let changed = false

  for (let leftIndex = 0; leftIndex < vias.length; leftIndex += 1) {
    const left = vias[leftIndex]
    if (!left) continue

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < vias.length;
      rightIndex += 1
    ) {
      const right = vias[rightIndex]
      if (!right) continue

      const requiredDistance =
        left.radius + right.radius + RELAXED_VIA_CLEARANCE + CLEARANCE_SLACK
      const separationX = left.x - right.x
      const separationY = left.y - right.y
      const distance = getVectorLength(separationX, separationY)
      const penetration = requiredDistance - distance
      if (penetration <= 0) continue

      const fallbackAngle =
        (leftIndex * 97 + rightIndex * 13) * 1.618_033_988_75
      const directionX =
        distance > POSITION_EPSILON
          ? separationX / distance
          : Math.cos(fallbackAngle)
      const directionY =
        distance > POSITION_EPSILON
          ? separationY / distance
          : Math.sin(fallbackAngle)
      const movableCount = Number(left.movable) + Number(right.movable)
      if (movableCount === 0) continue

      const move = Math.min(MAX_VIA_MOVE_PER_PASS, penetration / movableCount)
      changed =
        applyProjectionViaMove({
          routes,
          via: left,
          dx: directionX * move,
          dy: directionY * move,
          node,
        }) || changed
      changed =
        applyProjectionViaMove({
          routes,
          via: right,
          dx: -directionX * move,
          dy: -directionY * move,
          node,
        }) || changed
    }
  }

  return changed
}

const projectViaSegmentClearance = (params: {
  routes: HighDensityRoute[]
  node: NodeWithPortPoints
  vias: ProjectionViaNode[]
  segments: ProjectionSegment[]
}) => {
  const { routes, node, vias, segments } = params
  let changed = false

  for (let viaIndex = 0; viaIndex < vias.length; viaIndex += 1) {
    const via = vias[viaIndex]
    if (!via?.movable) continue

    for (const segment of segments) {
      if (via.rootConnectionName === segment.rootConnectionName) continue

      const projection = pointToProjectionSegment(via, segment)
      const separationX = via.x - projection.x
      const separationY = via.y - projection.y
      const distance = getVectorLength(separationX, separationY)
      const requiredDistance =
        via.radius +
        segment.traceRadius +
        RELAXED_TRACE_CLEARANCE +
        CLEARANCE_SLACK
      const penetration = requiredDistance - distance
      if (penetration <= 0) continue

      const segmentX = segment.end.x - segment.start.x
      const segmentY = segment.end.y - segment.start.y
      const normalMagnitude = getVectorLength(segmentX, segmentY)
      const fallbackSign = viaIndex % 2 === 0 ? 1 : -1
      const directionX =
        distance > POSITION_EPSILON
          ? separationX / distance
          : normalMagnitude > POSITION_EPSILON
            ? (-segmentY / normalMagnitude) * fallbackSign
            : 1
      const directionY =
        distance > POSITION_EPSILON
          ? separationY / distance
          : normalMagnitude > POSITION_EPSILON
            ? (segmentX / normalMagnitude) * fallbackSign
            : 0
      const move = Math.min(MAX_VIA_MOVE_PER_PASS, penetration)

      changed =
        applyProjectionViaMove({
          routes,
          via,
          dx: directionX * move,
          dy: directionY * move,
          node,
        }) || changed
    }
  }

  return changed
}

const applyProjectionRoutePointMove = (params: {
  routes: HighDensityRoute[]
  routeIndex: number
  pointIndex: number
  dx: number
  dy: number
  node: NodeWithPortPoints
}) => {
  const { routes, routeIndex, pointIndex, dx, dy, node } = params
  const route = routes[routeIndex]
  if (!route || pointIndex <= 0 || pointIndex >= route.route.length - 1) {
    return false
  }

  const pointIndexes = getCoincidentPointIndexes(route.route, pointIndex)
  if (includesProtectedEndpointSegmentPoint(route.route.length, pointIndexes)) {
    return false
  }

  const bounds = getInsetNodeBounds(node, POSITION_EPSILON)
  let changed = false
  for (const candidateIndex of pointIndexes) {
    const point = route.route[candidateIndex]
    if (!point) continue
    point.x = clampValue(point.x + dx, bounds.minX, bounds.maxX)
    point.y = clampValue(point.y + dy, bounds.minY, bounds.maxY)
    changed = true
  }

  return changed
}

const distributeProjectionSegmentMove = (params: {
  routes: HighDensityRoute[]
  segment: ProjectionSegment
  dx: number
  dy: number
  node: NodeWithPortPoints
  t: number
}) => {
  const { routes, segment, dx, dy, node, t } = params
  const startWeight = 1 - clampUnitInterval(t)
  const endWeight = clampUnitInterval(t)
  const movedStart = applyProjectionRoutePointMove({
    routes,
    routeIndex: segment.routeIndex,
    pointIndex: segment.startIndex,
    dx: dx * startWeight,
    dy: dy * startWeight,
    node,
  })
  const movedEnd = applyProjectionRoutePointMove({
    routes,
    routeIndex: segment.routeIndex,
    pointIndex: segment.endIndex,
    dx: dx * endWeight,
    dy: dy * endWeight,
    node,
  })

  return movedStart || movedEnd
}

const projectSegmentSegmentClearance = (params: {
  routes: HighDensityRoute[]
  node: NodeWithPortPoints
  segments: ProjectionSegment[]
  movableRouteIndexes?: ReadonlySet<number>
}) => {
  const { routes, node, segments, movableRouteIndexes } = params
  let changed = false

  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    const left = segments[leftIndex]
    if (!left) continue

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < segments.length;
      rightIndex += 1
    ) {
      const right = segments[rightIndex]
      if (
        !right ||
        left.z !== right.z ||
        left.rootConnectionName === right.rootConnectionName
      ) {
        continue
      }

      const requiredDistance =
        left.traceRadius +
        right.traceRadius +
        RELAXED_TRACE_CLEARANCE +
        CLEARANCE_SLACK
      if (
        Math.max(left.start.x, left.end.x) + requiredDistance <=
          Math.min(right.start.x, right.end.x) ||
        Math.max(right.start.x, right.end.x) + requiredDistance <=
          Math.min(left.start.x, left.end.x) ||
        Math.max(left.start.y, left.end.y) + requiredDistance <=
          Math.min(right.start.y, right.end.y) ||
        Math.max(right.start.y, right.end.y) + requiredDistance <=
          Math.min(left.start.y, left.end.y)
      ) {
        continue
      }

      const [candidate] = getProjectionSegmentDistanceCandidates(left, right)
      if (!candidate) continue

      const separationX = candidate.leftPoint.x - candidate.rightPoint.x
      const separationY = candidate.leftPoint.y - candidate.rightPoint.y
      const distance = getVectorLength(separationX, separationY)
      const penetration = requiredDistance - distance
      if (penetration <= 0) continue
      const leftMovable =
        !movableRouteIndexes || movableRouteIndexes.has(left.routeIndex)
      const rightMovable =
        !movableRouteIndexes || movableRouteIndexes.has(right.routeIndex)
      const movableCount = Number(leftMovable) + Number(rightMovable)
      if (movableCount === 0) continue

      const leftVectorX = left.end.x - left.start.x
      const leftVectorY = left.end.y - left.start.y
      const fallbackMagnitude = getVectorLength(leftVectorX, leftVectorY)
      const fallbackSign = (leftIndex + rightIndex) % 2 === 0 ? 1 : -1
      const directionX =
        distance > POSITION_EPSILON
          ? separationX / distance
          : fallbackMagnitude > POSITION_EPSILON
            ? (-leftVectorY / fallbackMagnitude) * fallbackSign
            : 1
      const directionY =
        distance > POSITION_EPSILON
          ? separationY / distance
          : fallbackMagnitude > POSITION_EPSILON
            ? (leftVectorX / fallbackMagnitude) * fallbackSign
            : 0
      const move = Math.min(MAX_TRACE_MOVE_PER_PASS, penetration / movableCount)

      if (leftMovable) {
        changed =
          distributeProjectionSegmentMove({
            routes,
            segment: left,
            dx: directionX * move,
            dy: directionY * move,
            node,
            t: candidate.leftT,
          }) || changed
      }
      if (rightMovable) {
        changed =
          distributeProjectionSegmentMove({
            routes,
            segment: right,
            dx: -directionX * move,
            dy: -directionY * move,
            node,
            t: candidate.rightT,
          }) || changed
      }
    }
  }

  return changed
}

const applyProjectionClearance = (
  node: NodeWithPortPoints,
  routes: HighDensityRoute[],
) => {
  for (let pass = 0; pass < VIA_PROJECTION_PASSES; pass += 1) {
    const vias = collectProjectionViaNodes(routes)
    const segments = collectProjectionSegments(routes)
    const viaToViaChanged = projectViaViaClearance({
      routes,
      node,
      vias,
    })
    const viaToSegmentChanged = projectViaSegmentClearance({
      routes,
      node,
      vias,
      segments,
    })
    const segmentToSegmentChanged = projectSegmentSegmentClearance({
      routes,
      node,
      segments,
    })

    if (!viaToViaChanged && !viaToSegmentChanged && !segmentToSegmentChanged) {
      break
    }
  }

  for (const route of routes) {
    route.vias = deriveVias(route)
  }

  return routes
}

const applySelectedRouteSegmentClearance = (
  node: NodeWithPortPoints,
  routes: HighDensityRoute[],
  movableRouteIndexes: ReadonlySet<number>,
) => {
  for (let pass = 0; pass < VIA_PROJECTION_PASSES; pass += 1) {
    const changed = projectSegmentSegmentClearance({
      routes,
      node,
      segments: collectProjectionSegments(routes),
      movableRouteIndexes,
    })
    if (!changed) break
  }
  for (const routeIndex of movableRouteIndexes) {
    const route = routes[routeIndex]
    if (route) route.vias = deriveVias(route)
  }
  return routes
}
const resolveClearanceConstraints = (
  bounds: Bounds,
  mutableRoutes: MutableRoute[],
  forceElements: ForceElement[],
  segments: SegmentObstacle[],
  nodeCorrections: Float64Array,
  segmentIndexCache: SegmentSpatialIndexCache,
  passCount = CLEARANCE_PROJECTION_PASSES,
  maxCorrection = MAX_CLEARANCE_CORRECTION,
  stats?: SparseForceStats,
) => {
  for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
    // A positive constraint can cancel or clamp to zero; zero motion is not proof.
    let hasActivePenetration = false
    if (stats) {
      stats.projectionPassesExecuted += 1
    }
    nodeCorrections.fill(0)
    const segmentSpatialIndex = getCachedSegmentSpatialIndex(segmentIndexCache)

    for (let leftIndex = 0; leftIndex < forceElements.length; leftIndex += 1) {
      const leftElement = forceElements[leftIndex]
      if (!leftElement || leftElement.kind !== "via") continue
      const leftNode = leftElement.node

      for (
        let rightIndex = leftIndex + 1;
        rightIndex < forceElements.length;
        rightIndex += 1
      ) {
        const rightElement = forceElements[rightIndex]
        if (!rightElement || rightElement.kind !== "via") continue
        if (
          leftElement.rootConnectionName === rightElement.rootConnectionName
        ) {
          continue
        }
        const rightNode = rightElement.node
        if (leftElement.fixed && rightElement.fixed) {
          if (stats) stats.noWritePairsSkipped += 1
          continue
        }

        const separationX = leftNode.x - rightNode.x
        const separationY = leftNode.y - rightNode.y
        if (
          Math.abs(separationX) >= TARGET_CLEARANCE ||
          Math.abs(separationY) >= TARGET_CLEARANCE
        ) {
          continue
        }
        const distance = getVectorLength(separationX, separationY)
        const penetration = TARGET_CLEARANCE - distance
        if (penetration <= 0) continue
        hasActivePenetration = true

        const fallbackSeed =
          passIndex * 1_009 + leftIndex * 97 + rightIndex * 13
        let directionX = 0
        let directionY = 0

        if (distance > POSITION_EPSILON) {
          const inverseDistance = 1 / distance
          directionX = separationX * inverseDistance
          directionY = separationY * inverseDistance
        } else {
          const angle = fallbackSeed * 1.618_033_988_75
          directionX = Math.cos(angle)
          directionY = Math.sin(angle)
        }

        const magnitude = Math.min(
          maxCorrection,
          penetration * CLEARANCE_PROJECTION_RATIO,
        )
        const leftCorrectionX = directionX * magnitude
        const leftCorrectionY = directionY * magnitude

        applyForceToElement(
          leftElement,
          leftCorrectionX,
          leftCorrectionY,
          nodeCorrections,
        )
        applyForceToElement(
          rightElement,
          -leftCorrectionX,
          -leftCorrectionY,
          nodeCorrections,
        )
      }
    }

    for (
      let elementIndex = 0;
      elementIndex < forceElements.length;
      elementIndex += 1
    ) {
      const element = forceElements[elementIndex]
      if (!element) continue
      const elementNode = element.node
      const targetClearance = getElementTargetClearance(element)
      const segmentSearches = getSegmentSpatialSearches(
        segmentSpatialIndex,
        element,
        elementNode.x,
        elementNode.y,
        targetClearance,
      )

      for (const segmentSearch of segmentSearches) {
        for (const candidateIndex of segmentSearch.candidateIndexes) {
          const segment = segmentSearch.segments[candidateIndex]
          if (!segment) continue
          if (element.rootConnectionName === segment.rootConnectionName) {
            continue
          }
          const { startNode, endNode } = segment
          if (element.fixed && startNode.fixed && endNode.fixed) {
            if (stats) stats.noWritePairsSkipped += 1
            continue
          }

          const segmentX = endNode.x - startNode.x
          const segmentY = endNode.y - startNode.y
          const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
          if (segmentLengthSquared <= POSITION_EPSILON) {
            continue
          }

          const toPointX = elementNode.x - startNode.x
          const toPointY = elementNode.y - startNode.y
          const segmentT = clampUnitInterval(
            (toPointX * segmentX + toPointY * segmentY) / segmentLengthSquared,
          )
          const closestPointX = startNode.x + segmentX * segmentT
          const closestPointY = startNode.y + segmentY * segmentT
          const separationX = elementNode.x - closestPointX
          const separationY = elementNode.y - closestPointY
          const distance = getVectorLength(separationX, separationY)
          const penetration = targetClearance - distance
          if (penetration <= 0) continue
          hasActivePenetration = true

          const fallbackSeed =
            passIndex * 1_009 + elementIndex * 97 + segment.obstacleIndex * 13
          let directionX = 0
          let directionY = 0

          if (distance > POSITION_EPSILON) {
            const inverseDistance = 1 / distance
            directionX = separationX * inverseDistance
            directionY = separationY * inverseDistance
          } else {
            const normalX = -segmentY
            const normalY = segmentX
            const normalMagnitude = getVectorLength(normalX, normalY)
            if (normalMagnitude > POSITION_EPSILON) {
              const directionScale =
                (fallbackSeed % 2 === 0 ? 1 : -1) / normalMagnitude
              directionX = normalX * directionScale
              directionY = normalY * directionScale
            } else {
              const angle = fallbackSeed * 1.618_033_988_75
              directionX = Math.cos(angle)
              directionY = Math.sin(angle)
            }
          }

          const magnitude = Math.min(
            getMaxCorrectionForElement(element, maxCorrection),
            penetration * getProjectionRatio(element),
          )
          const pointCorrectionX = directionX * magnitude
          const pointCorrectionY = directionY * magnitude

          applyForceToElement(
            element,
            pointCorrectionX,
            pointCorrectionY,
            nodeCorrections,
          )
          distributeForceToSegmentPoints(
            segment,
            -pointCorrectionX,
            -pointCorrectionY,
            nodeCorrections,
            segmentT,
          )
        }
      }
    }

    for (
      let routeIndex = 0;
      routeIndex < mutableRoutes.length;
      routeIndex += 1
    ) {
      const mutableRoute = mutableRoutes[routeIndex]
      if (!mutableRoute) continue

      for (
        let nodeIndex = 0;
        nodeIndex < mutableRoute.nodes.length;
        nodeIndex += 1
      ) {
        const node = mutableRoute.nodes[nodeIndex]
        if (!node || node.fixed) continue
        const correctionOffset = node.forceIndex * 2
        let correctionX = nodeCorrections[correctionOffset] ?? 0
        let correctionY = nodeCorrections[correctionOffset + 1] ?? 0
        const correctionMagnitude = getVectorLength(correctionX, correctionY)

        if (
          correctionMagnitude > maxCorrection &&
          correctionMagnitude > POSITION_EPSILON
        ) {
          const correctionScale = maxCorrection / correctionMagnitude
          correctionX *= correctionScale
          correctionY *= correctionScale
        }

        const previousX = node.x
        const previousY = node.y
        node.x += correctionX
        node.y += correctionY
        invalidateSegmentIndexAfterNodeChange(
          segmentIndexCache, node, previousX, previousY,
        )
      }
    }

    clampMutableRoutesToBounds(mutableRoutes, bounds, true, stats, segmentIndexCache)
    // With no writable positive constraint, later passes see identical geometry.
    // Keep the first update/clamp, including the native signed-zero behavior.
    if (!hasActivePenetration) {
      if (stats) {
        stats.inactiveProjectionExits += 1
        stats.projectionPassesSkipped += passCount - passIndex - 1
        stats.inactiveProjectionPassesSkipped += passCount - passIndex - 1
      }
      break
    }
  }
}

export const runSparseForceDirectedImprovement = (
  bounds: Bounds,
  routes: HighDensityRoute[],
  totalSteps: number,
  options?: ForceImproveOptions,
): ForceImproveResult => {
  const { mutableRoutes, totalNodeCount } = buildMutableRoutes(routes)
  const forceElements = buildForceElements(mutableRoutes)
  const segments = buildSegmentObstacles(mutableRoutes)
  const nodeForces = new Float64Array(totalNodeCount * 2)
  const nodeCorrections = new Float64Array(totalNodeCount * 2)
  const includeForceVectors = options?.includeForceVectors ?? true
  const stats = options?.stats
  if (stats) {
    stats.activated = true
    stats.kernelCalls += 1
    stats.requestedForceSteps += Math.max(0, Math.ceil(totalSteps))
    for (const mutableRoute of mutableRoutes) {
      for (const node of mutableRoute.nodes) {
        if (node.fixed) stats.fixedNodeCount += 1
        else stats.mutableNodeCount += 1
      }
    }
  }
  clampMutableRoutesToBounds(mutableRoutes, bounds)
  let forceVectors: ForceVector[] = []

  // Protected nodes cannot receive any numerical update. Keep the native initial
  // clamp, rounding/via materialization, and final zero-vector records exactly.
  const allFixed = mutableRoutes.every((route) =>
    route.nodes.every((node) => node.fixed),
  )
  if (allFixed && Number.isSafeInteger(totalSteps) && totalSteps >= 0 &&
      Object.values(bounds).every(Number.isFinite) &&
      mutableRoutes.every((route) => route.nodes.every((node) =>
        Number.isFinite(node.x) && Number.isFinite(node.y)))) {
    if (stats) {
      stats.allFixedCalls += 1
      stats.skippedForceSteps += totalSteps
      stats.projectionPassesSkipped += totalSteps * CLEARANCE_PROJECTION_PASSES +
        FINAL_CLEARANCE_PROJECTION_PASSES
    }
    if (includeForceVectors && totalSteps > 0) {
      forceVectors = forceElements.map((element) => ({
        kind: element.kind,
        routeIndex: element.routeIndex,
        rootConnectionName: element.rootConnectionName,
        x: element.node.x,
        y: element.node.y,
        dx: 0,
        dy: 0,
      }))
    }
    return { routes: materializeRoutes(mutableRoutes), forceVectors,
      stepsCompleted: totalSteps }
  }

  // This cache never escapes one synchronous kernel call. Segment membership,
  // order, layer, owner, and fixed flags are finalized above and never change
  // inside the kernel. Every coordinate write below invalidates on bitwise change.
  // Reuse the original full tree only; no query/candidate order is reconstructed.
  const segmentIndexCache: SegmentSpatialIndexCache = {
    segments, index: null, stats, reuseStats: options?.indexReuseStats,
  }
  if (segmentIndexCache.reuseStats) {
    segmentIndexCache.reuseStats.kernelCachesCreated += 1
  }

  for (let stepIndex = 0; stepIndex < totalSteps; stepIndex += 1) {
    if (stats) stats.executedForceSteps += 1
    const progress =
      totalSteps <= 1 ? 0 : stepIndex / Math.max(totalSteps - 1, 1)
    const stepDecay = MIN_STEP_DECAY + (1 - progress) * (1 - MIN_STEP_DECAY)
    const tighteningDecay = 1 - progress
    const captureForceVectors =
      includeForceVectors && stepIndex === totalSteps - 1
    const elementForces = captureForceVectors
      ? new Float64Array(forceElements.length * 2)
      : undefined
    nodeForces.fill(0)

    for (let leftIndex = 0; leftIndex < forceElements.length; leftIndex += 1) {
      const leftElement = forceElements[leftIndex]
      if (!leftElement || leftElement.kind !== "via") continue
      const leftNode = leftElement.node

      for (
        let rightIndex = leftIndex + 1;
        rightIndex < forceElements.length;
        rightIndex += 1
      ) {
        const rightElement = forceElements[rightIndex]
        if (!rightElement || rightElement.kind !== "via") continue
        if (
          leftElement.rootConnectionName === rightElement.rootConnectionName
        ) {
          continue
        }
        const rightNode = rightElement.node
        if (leftElement.fixed && rightElement.fixed) {
          if (stats) stats.noWritePairsSkipped += 1
          continue
        }

        const separationX = leftNode.x - rightNode.x
        const separationY = leftNode.y - rightNode.y
        if (
          Math.abs(separationX) >= CLEARANCE_FALLOFF_DISTANCE ||
          Math.abs(separationY) >= CLEARANCE_FALLOFF_DISTANCE
        ) {
          continue
        }
        const distance = getVectorLength(separationX, separationY)
        const fallbackSeed = leftIndex * 97 + rightIndex * 13
        let directionX = 0
        let directionY = 0

        if (distance > POSITION_EPSILON) {
          const inverseDistance = 1 / distance
          directionX = separationX * inverseDistance
          directionY = separationY * inverseDistance
        } else {
          const angle = fallbackSeed * 1.618_033_988_75
          directionX = Math.cos(angle)
          directionY = Math.sin(angle)
        }

        const magnitude =
          getClearanceForceMagnitude(
            distance,
            VIA_VIA_REPULSION_STRENGTH,
            REPULSION_TAIL_RATIO,
            REPULSION_FALLOFF,
          ) * stepDecay

        if (magnitude <= 0) continue

        const leftForceX = directionX * magnitude
        const leftForceY = directionY * magnitude
        applyForceToElement(
          leftElement,
          leftForceX,
          leftForceY,
          nodeForces,
          elementForces,
          leftIndex,
        )
        applyForceToElement(
          rightElement,
          -leftForceX,
          -leftForceY,
          nodeForces,
          elementForces,
          rightIndex,
        )
      }
    }

    const segmentSpatialIndex = getCachedSegmentSpatialIndex(segmentIndexCache)
    for (
      let elementIndex = 0;
      elementIndex < forceElements.length;
      elementIndex += 1
    ) {
      const element = forceElements[elementIndex]
      if (!element) continue
      const elementNode = element.node
      const falloffDistance = getElementFalloffDistance(element)
      const segmentSearches = getSegmentSpatialSearches(
        segmentSpatialIndex,
        element,
        elementNode.x,
        elementNode.y,
        falloffDistance,
      )

      for (const segmentSearch of segmentSearches) {
        for (const candidateIndex of segmentSearch.candidateIndexes) {
          const segment = segmentSearch.segments[candidateIndex]
          if (!segment) continue
          if (element.rootConnectionName === segment.rootConnectionName) {
            continue
          }
          const { startNode, endNode } = segment
          if (element.fixed && startNode.fixed && endNode.fixed) {
            if (stats) stats.noWritePairsSkipped += 1
            continue
          }

          const segmentX = endNode.x - startNode.x
          const segmentY = endNode.y - startNode.y
          const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY
          if (segmentLengthSquared <= POSITION_EPSILON) {
            continue
          }

          const toPointX = elementNode.x - startNode.x
          const toPointY = elementNode.y - startNode.y
          const segmentT = clampUnitInterval(
            (toPointX * segmentX + toPointY * segmentY) / segmentLengthSquared,
          )
          const closestPointX = startNode.x + segmentX * segmentT
          const closestPointY = startNode.y + segmentY * segmentT
          const separationX = elementNode.x - closestPointX
          const separationY = elementNode.y - closestPointY
          const distance = getVectorLength(separationX, separationY)
          const fallbackSeed = elementIndex * 97 + segment.obstacleIndex * 13
          let directionX = 0
          let directionY = 0

          if (distance > POSITION_EPSILON) {
            const inverseDistance = 1 / distance
            directionX = separationX * inverseDistance
            directionY = separationY * inverseDistance
          } else {
            const normalX = -segmentY
            const normalY = segmentX
            const normalMagnitude = getVectorLength(normalX, normalY)
            if (normalMagnitude > POSITION_EPSILON) {
              const directionScale =
                (fallbackSeed % 2 === 0 ? 1 : -1) / normalMagnitude
              directionX = normalX * directionScale
              directionY = normalY * directionScale
            } else {
              const angle = fallbackSeed * 1.618_033_988_75
              directionX = Math.cos(angle)
              directionY = Math.sin(angle)
            }
          }

          const magnitude =
            getClearanceForceMagnitude(
              distance,
              getPointSegmentRepulsionStrength(element),
              REPULSION_TAIL_RATIO,
              REPULSION_FALLOFF,
              getElementIntersectionBoost(element),
              getElementTargetClearance(element),
              falloffDistance,
            ) * stepDecay

          if (magnitude <= 0) continue

          const pointForceX = directionX * magnitude
          const pointForceY = directionY * magnitude

          applyForceToElement(
            element,
            pointForceX,
            pointForceY,
            nodeForces,
            elementForces,
            elementIndex,
          )
          distributeForceToSegmentPoints(
            segment,
            -pointForceX,
            -pointForceY,
            nodeForces,
            segmentT,
          )
        }
      }
    }

    if (captureForceVectors) {
      forceVectors = new Array<ForceVector>(forceElements.length)
    }

    for (
      let elementIndex = 0;
      elementIndex < forceElements.length;
      elementIndex += 1
    ) {
      const element = forceElements[elementIndex]
      if (!element) continue
      const elementNode = element.node

      const borderForce = getBorderForce(
        bounds,
        element,
        elementNode.x,
        elementNode.y,
        stepDecay,
      )
      applyForceToElement(
        element,
        borderForce.x,
        borderForce.y,
        nodeForces,
        elementForces,
        elementIndex,
      )

      if (captureForceVectors && elementForces) {
        const forceOffset = elementIndex * 2
        forceVectors[elementIndex] = {
          kind: element.kind,
          routeIndex: element.routeIndex,
          rootConnectionName: element.rootConnectionName,
          x: elementNode.x,
          y: elementNode.y,
          dx: elementForces[forceOffset] ?? 0,
          dy: elementForces[forceOffset + 1] ?? 0,
        }
      }
    }

    for (
      let routeIndex = 0;
      routeIndex < mutableRoutes.length;
      routeIndex += 1
    ) {
      const mutableRoute = mutableRoutes[routeIndex]
      if (!mutableRoute) continue
      const lastMovableNodeIndex = mutableRoute.nodes.length - 2

      for (
        let nodeIndex = 0;
        nodeIndex < mutableRoute.nodes.length;
        nodeIndex += 1
      ) {
        const node = mutableRoute.nodes[nodeIndex]
        if (!node || node.fixed) continue
        const forceOffset = node.forceIndex * 2
        let nextForceX =
          (nodeForces[forceOffset] ?? 0) +
          (node.originalX - node.x) * SHAPE_RESTORE_STRENGTH
        let nextForceY =
          (nodeForces[forceOffset + 1] ?? 0) +
          (node.originalY - node.y) * SHAPE_RESTORE_STRENGTH
        let tighteningMoveX = 0
        let tighteningMoveY = 0
        let orthogonalMoveX = 0
        let orthogonalMoveY = 0

        const previousNode = mutableRoute.nodes[nodeIndex - 1]
        const nextNode = mutableRoute.nodes[nodeIndex + 1]
        if (previousNode || nextNode) {
          let totalReferenceX = 0
          let totalReferenceY = 0
          let referenceCount = 0

          if (previousNode) {
            totalReferenceX += previousNode.x
            totalReferenceY += previousNode.y
            referenceCount += 1
          }

          if (nextNode) {
            totalReferenceX += nextNode.x
            totalReferenceY += nextNode.y
            referenceCount += 1
          }

          if (referenceCount > 0) {
            const inverseReferenceCount = 1 / referenceCount
            nextForceX +=
              (totalReferenceX * inverseReferenceCount - node.x) *
              PATH_SMOOTHING_STRENGTH
            nextForceY +=
              (totalReferenceY * inverseReferenceCount - node.y) *
              PATH_SMOOTHING_STRENGTH
          }
        }

        if (previousNode && nextNode && tighteningDecay > 0) {
          const segmentVector = subtractVector(nextNode, previousNode)
          const segmentLengthSquared = dotVector(segmentVector, segmentVector)

          if (segmentLengthSquared > POSITION_EPSILON) {
            const projectionT = clampUnitInterval(
              dotVector(subtractVector(node, previousNode), segmentVector) /
                segmentLengthSquared,
            )
            const tighteningTarget = lerpVector(
              previousNode,
              nextNode,
              projectionT,
            )
            const tighteningMove = clampVectorMagnitude(
              scaleVector(
                subtractVector(tighteningTarget, node),
                TIGHTENING_FORCE_STRENGTH * tighteningDecay,
              ),
              MAX_TIGHTENING_MOVE_PER_STEP * tighteningDecay,
            )

            tighteningMoveX = tighteningMove.x
            tighteningMoveY = tighteningMove.y
          }
        }

        if (tighteningDecay > 0) {
          if (nodeIndex === 1 && previousNode?.fixed) {
            const orthogonalMove = getEndpointOrthogonalMove(
              previousNode,
              node,
              bounds,
              tighteningDecay,
            )
            orthogonalMoveX += orthogonalMove.x
            orthogonalMoveY += orthogonalMove.y
          }

          if (nodeIndex === lastMovableNodeIndex && nextNode?.fixed) {
            const orthogonalMove = getEndpointOrthogonalMove(
              nextNode,
              node,
              bounds,
              tighteningDecay,
            )
            orthogonalMoveX += orthogonalMove.x
            orthogonalMoveY += orthogonalMove.y
          }
        }

        let movementX = nextForceX * STEP_SIZE * stepDecay
        let movementY = nextForceY * STEP_SIZE * stepDecay
        const movementMagnitude = getVectorLength(movementX, movementY)
        const maxMovementMagnitude = MAX_NODE_MOVE_PER_STEP * stepDecay

        if (
          movementMagnitude > maxMovementMagnitude &&
          movementMagnitude > POSITION_EPSILON
        ) {
          const movementScale = maxMovementMagnitude / movementMagnitude
          movementX *= movementScale
          movementY *= movementScale
        }

        const previousX = node.x
        const previousY = node.y
        node.x += movementX + tighteningMoveX + orthogonalMoveX
        node.y += movementY + tighteningMoveY + orthogonalMoveY
        invalidateSegmentIndexAfterNodeChange(
          segmentIndexCache, node, previousX, previousY,
        )
      }
    }

    clampMutableRoutesToBounds(mutableRoutes, bounds, true, stats, segmentIndexCache)
    resolveClearanceConstraints(
      bounds,
      mutableRoutes,
      forceElements,
      segments,
      nodeCorrections,
      segmentIndexCache,
      CLEARANCE_PROJECTION_PASSES,
      MAX_CLEARANCE_CORRECTION,
      stats,
    )
  }

  resolveClearanceConstraints(
    bounds,
    mutableRoutes,
    forceElements,
    segments,
    nodeCorrections,
    segmentIndexCache,
    FINAL_CLEARANCE_PROJECTION_PASSES,
    FINAL_MAX_CLEARANCE_CORRECTION,
    stats,
  )

  const improvedRoutes = materializeRoutes(mutableRoutes)

  return {
    routes: improvedRoutes,
    forceVectors,
    stepsCompleted: totalSteps,
  }
}

export class SparseHighDensityForceImproveSolver extends BaseSolver {
  readonly sampleEntries: ForceImproveSampleEntry[]
  readonly originalHdRoutes: HighDensityRoute[]
  readonly originalNodeWithPortPoints: NodeWithPortPoints[]
  readonly colorMap: Record<string, string>
  readonly totalStepsPerNode: number
  readonly nodeAssignmentMargin: number

  readonly sparseForceStats = createSparseForceStats()
  improvedRoutesByIndex = new Map<number, HighDensityRoute>()
  activeSampleIndex = 0
  latestVisualization: GraphicsObject = {}

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints[]
    hdRoutes: HighDensityRoute[]
    totalStepsPerNode?: number
    nodeAssignmentMargin?: number
    colorMap?: Record<string, string>
  }) {
    super()
    this.originalHdRoutes = params.hdRoutes
    this.originalNodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.totalStepsPerNode =
      params.totalStepsPerNode ?? DEFAULT_TOTAL_STEPS_PER_NODE
    this.nodeAssignmentMargin =
      params.nodeAssignmentMargin ?? DEFAULT_ASSIGNMENT_MARGIN

    const routeIndexesByNode = new Map<number, number[]>()
    for (let i = 0; i < params.hdRoutes.length; i++) {
      const nodeIndex = findNodeIndexForRoute(
        params.hdRoutes[i],
        params.nodeWithPortPoints,
        this.nodeAssignmentMargin,
      )
      if (nodeIndex === -1) continue
      const routeIndexes = routeIndexesByNode.get(nodeIndex) ?? []
      routeIndexes.push(i)
      routeIndexesByNode.set(nodeIndex, routeIndexes)
    }

    this.sampleEntries = Array.from(routeIndexesByNode.entries()).map(
      ([nodeIndex, routeIndexes]) => ({
        node: params.nodeWithPortPoints[nodeIndex],
        routeIndexes,
      }),
    )

    this.MAX_ITERATIONS = Math.max(this.sampleEntries.length * 10, 1_000)
    this.stats = {
      nodeAssignmentMargin: this.nodeAssignmentMargin,
      sampleCount: this.sampleEntries.length,
      improvedNodeCount: 0,
      improvedRouteCount: 0,
      totalStepsPerNode: this.totalStepsPerNode,
    }
  }

  override getSolverName(): string {
    return "HighDensityForceImproveSolver"
  }

  override getConstructorParams() {
    return [
      {
        nodeWithPortPoints: this.originalNodeWithPortPoints,
        hdRoutes: this.originalHdRoutes,
        totalStepsPerNode: this.totalStepsPerNode,
        nodeAssignmentMargin: this.nodeAssignmentMargin,
        colorMap: this.colorMap,
      },
    ] as const
  }

  override _step() {
    const sampleEntry = this.sampleEntries[this.activeSampleIndex]

    if (!sampleEntry) {
      this.solved = true
      return
    }

    this.sparseForceStats.sampleNodes += 1
    const bounds = getNodeBounds(sampleEntry.node)
    const inputRoutes = sampleEntry.routeIndexes.map(
      (routeIndex) => this.originalHdRoutes[routeIndex],
    )
    const baselineResult = runSparseForceDirectedImprovement(
      bounds,
      inputRoutes,
      this.totalStepsPerNode,
      { includeForceVectors: true, stats: this.sparseForceStats },
    )
    applyProjectionClearance(sampleEntry.node, baselineResult.routes)
    const segmentPairBarrierSelectors = findNewProperSegmentCrossings(
      inputRoutes,
      baselineResult.routes,
    )
    let result =
      segmentPairBarrierSelectors.length === 0
        ? baselineResult
        : runSparseForceDirectedImprovement(
            bounds,
            preconditionRoutesForNewCrossings(
              {
                routes: inputRoutes,
                node: sampleEntry.node,
                selectors: segmentPairBarrierSelectors,
              },
              distributeProjectionSegmentMove,
            ),
            this.totalStepsPerNode,
            { includeForceVectors: true, stats: this.sparseForceStats },
          )
    if (result !== baselineResult) {
      applyProjectionClearance(sampleEntry.node, result.routes)
      const residualCrossingSelectors = findNewProperSegmentCrossings(
        inputRoutes,
        result.routes,
      )
      if (residualCrossingSelectors.length > 0) {
        const alignedRoutes = findAlignedTopologyCandidate(
          {
            originalRoutes: inputRoutes,
            guardedRoutes: result.routes,
            node: sampleEntry.node,
            crossingSelectors: residualCrossingSelectors,
            protectedSelectors: [
              ...segmentPairBarrierSelectors,
              ...residualCrossingSelectors,
            ],
          },
          applySelectedRouteSegmentClearance,
        )
        if (alignedRoutes) result = { ...result, routes: alignedRoutes }
      }
    }

    for (let i = 0; i < sampleEntry.routeIndexes.length; i++) {
      this.improvedRoutesByIndex.set(
        sampleEntry.routeIndexes[i],
        result.routes[i],
      )
    }

    this.latestVisualization = createForceImproveVisualization({
      node: sampleEntry.node,
      routes: result.routes,
      forceVectors: result.forceVectors,
      colorMap: this.colorMap,
    })

    this.activeSampleIndex += 1
    this.stats = {
      nodeAssignmentMargin: this.nodeAssignmentMargin,
      sampleCount: this.sampleEntries.length,
      improvedNodeCount: this.activeSampleIndex,
      improvedRouteCount: this.improvedRoutesByIndex.size,
      totalStepsPerNode: this.totalStepsPerNode,
    }

    if (this.activeSampleIndex >= this.sampleEntries.length) {
      this.solved = true
    }
  }

  getOutput(): HighDensityRoute[] {
    return this.originalHdRoutes.map(
      (route, index) => this.improvedRoutesByIndex.get(index) ?? route,
    )
  }

  override visualize(): GraphicsObject {
    if (!this.solved) {
      return this.latestVisualization
    }

    return createForceImproveVisualization({
      routes: this.getOutput(),
      colorMap: this.colorMap,
    })
  }
}

const createForceImproveVisualization = (params: {
  node?: NodeWithPortPoints
  routes: HighDensityRoute[]
  forceVectors?: ForceVector[]
  colorMap?: Record<string, string>
}): GraphicsObject => {
  const lines: NonNullable<GraphicsObject["lines"]> = []
  const circles: NonNullable<GraphicsObject["circles"]> = []
  const rects: NonNullable<GraphicsObject["rects"]> = []

  if (params.node) {
    rects.push({
      center: params.node.center,
      width: params.node.width,
      height: params.node.height,
      stroke: "rgba(14,165,233,0.7)",
      fill: "rgba(14,165,233,0.04)",
      label: params.node.capacityMeshNodeId,
    })
  }

  for (const route of params.routes) {
    const strokeColor = params.colorMap?.[route.connectionName] ?? "#0ea5e9"
    for (let i = 0; i < route.route.length - 1; i++) {
      const start = route.route[i]
      const end = route.route[i + 1]
      if (start.z !== end.z) continue
      lines.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor:
          start.z === 0 ? strokeColor : safeTransparentize(strokeColor, 0.5),
        strokeWidth: route.traceThickness,
        layer: `z${start.z}`,
        strokeDash: start.z !== 0 ? [0.1, 0.3] : undefined,
      })
    }

    for (const via of route.vias) {
      circles.push({
        center: { x: via.x, y: via.y },
        radius: route.viaDiameter / 2,
        stroke: strokeColor,
        fill: "rgba(14,165,233,0.12)",
      })
    }
  }

  for (const forceVector of params.forceVectors ?? []) {
    lines.push({
      points: [
        { x: forceVector.x, y: forceVector.y },
        {
          x: forceVector.x + forceVector.dx * FORCE_VECTOR_DISPLAY_MULTIPLIER,
          y: forceVector.y + forceVector.dy * FORCE_VECTOR_DISPLAY_MULTIPLIER,
        },
      ],
      strokeColor: "rgba(244,63,94,0.85)",
      strokeWidth: 0.06,
      strokeDash: [0.08, 0.08],
    })
  }

  return { lines, circles, rects }
}
