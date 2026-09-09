import type { FixedCopperRectangle } from "lib/data-structures/FixedCopperClearanceIndex"
import { RbushIndex } from "lib/data-structures/RbushIndex"
import { getFixedCopperPortalSites } from "lib/solvers/UniformPortDistributionSolver/getFixedCopperPortalSites"
import type { CapacityMeshNode } from "lib/types"
import { areNodesBordering } from "lib/utils/areNodesBordering"
import {
  MIN_CONNECTIVITY_BRIDGE_DIMENSION,
  type PhysicalNodeCut,
  type PhysicalNodeCutContext,
} from "./physicalNodeCuts"

type Point = Readonly<{ x: number; y: number }>
type IndexedRectangle = {
  readonly rectangle: FixedCopperRectangle
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

export type FixedCopperNodeCutContext = {
  readonly rectangleIndex: RbushIndex<IndexedRectangle>
  readonly protectedPointIndex: RbushIndex<Point>
  readonly layerCount: number
  readonly traceWidth: number
  readonly traceGap: number
  readonly padGap: number
  readonly routableNetIds: ReadonlySet<string>
}

export type FixedCopperNodeCuts = {
  readonly nodes: CapacityMeshNode[]
  readonly cuts: PhysicalNodeCut[]
}

/** Prepare source-only indexes once, before any node is subdivided. */
export const createFixedCopperNodeCutContext = (
  input: PhysicalNodeCutContext,
): FixedCopperNodeCutContext => {
  if (
    !Number.isSafeInteger(input.layerCount) ||
    input.layerCount <= 0 ||
    !Number.isFinite(input.traceWidth) ||
    input.traceWidth <= 0 ||
    input.traceWidth / 2 <= 0 ||
    !Number.isFinite(input.traceGap) ||
    input.traceGap < 0 ||
    !Number.isFinite(input.padGap) ||
    input.padGap < 0 ||
    !Number.isFinite(input.traceWidth + input.traceGap) ||
    !Number.isFinite(input.traceWidth / 2 + input.padGap) ||
    input.routableNetIds.size === 0
  ) {
    throw new Error("Physical node cuts require finite physical rules and nets")
  }
  const routableNetIds = new Set(input.routableNetIds)
  for (const netId of routableNetIds) {
    if (typeof netId !== "string" || netId.length === 0) {
      throw new Error("Physical node cuts require canonical route net IDs")
    }
  }
  const rectangleIndex = new RbushIndex<IndexedRectangle>()
  const rectangleEntries: Array<{
    item: IndexedRectangle
    minX: number
    minY: number
    maxX: number
    maxY: number
  }> = []
  for (const rectangle of input.rectangles) {
    const rotation =
      rectangle.ccwRotationDegrees === undefined
        ? 0
        : rectangle.ccwRotationDegrees
    if (
      rectangle.kind !== "fixed-rectangle" ||
      !Number.isFinite(rectangle.center.x) ||
      !Number.isFinite(rectangle.center.y) ||
      !Number.isFinite(rectangle.width) ||
      rectangle.width <= 0 ||
      !Number.isFinite(rectangle.height) ||
      rectangle.height <= 0 ||
      rectangle.width / 2 <= 0 ||
      rectangle.height / 2 <= 0 ||
      !Number.isFinite(rotation) ||
      rectangle.zLayers.length === 0
    ) {
      throw new Error(
        "Physical node cuts have invalid fixed rectangle geometry",
      )
    }
    for (const z of rectangle.zLayers) {
      if (!Number.isInteger(z) || z < 0 || z >= input.layerCount) {
        throw new Error("Physical node cuts have an invalid rectangle layer")
      }
    }
    for (const owner of rectangle.ownerNetIds) {
      if (typeof owner !== "string" || owner.length === 0) {
        throw new Error("Physical node cuts have an invalid rectangle owner")
      }
    }
    const angle = ((rotation % 360) * Math.PI) / 180
    const halfWidth =
      Math.abs(Math.cos(angle)) * (rectangle.width / 2) +
      Math.abs(Math.sin(angle)) * (rectangle.height / 2)
    const halfHeight =
      Math.abs(Math.sin(angle)) * (rectangle.width / 2) +
      Math.abs(Math.cos(angle)) * (rectangle.height / 2)
    const bounds = {
      minX: rectangle.center.x - halfWidth,
      minY: rectangle.center.y - halfHeight,
      maxX: rectangle.center.x + halfWidth,
      maxY: rectangle.center.y + halfHeight,
    }
    if (
      Object.values(bounds).some((value): boolean => !Number.isFinite(value))
    ) {
      throw new Error("Physical node cuts cannot represent rectangle bounds")
    }
    if (
      [...rectangle.ownerNetIds].some((owner): boolean =>
        routableNetIds.has(owner),
      )
    ) {
      continue
    }
    const item: IndexedRectangle = {
      ...bounds,
      rectangle: {
        ...rectangle,
        center: { ...rectangle.center },
        zLayers: [...rectangle.zLayers],
        ownerNetIds: new Set(rectangle.ownerNetIds),
      },
    }
    rectangleEntries.push({ item, ...bounds })
  }
  rectangleIndex.bulkLoad(rectangleEntries)
  const protectedPointIndex = new RbushIndex<Point>()
  for (const sourcePoint of input.protectedPoints) {
    if (!Number.isFinite(sourcePoint.x) || !Number.isFinite(sourcePoint.y)) {
      throw new Error("Physical node cuts have an invalid protected point")
    }
    const point = { ...sourcePoint }
    protectedPointIndex.insert(point, point.x, point.y, point.x, point.y)
  }
  return {
    rectangleIndex,
    protectedPointIndex,
    layerCount: input.layerCount,
    traceWidth: input.traceWidth,
    traceGap: input.traceGap,
    padGap: input.padGap,
    routableNetIds,
  }
}

const isOrdinaryPhysicalCutNode = (node: CapacityMeshNode): boolean => {
  return !(
    node._isComponentTopologyNode ||
    node._containsObstacle ||
    node._completelyInsideObstacle ||
    node._containsTarget ||
    node._targetConnectionName !== undefined ||
    node._strawNode ||
    node._strawParentCapacityMeshNodeId !== undefined ||
    node._isVirtualOffboard ||
    node._offboardNetName !== undefined ||
    node._offBoardConnectionId !== undefined ||
    node._offBoardConnectedCapacityMeshNodeIds !== undefined ||
    node._qfpRegionType !== undefined ||
    node._isNarrowQfpPadGap ||
    node._soicRegionType !== undefined ||
    (node._connectedTo !== undefined && node._connectedTo.length > 0) ||
    (node._adjacentNodeIds !== undefined && node._adjacentNodeIds.length > 0) ||
    node._parent !== undefined
  )
}

/**
 * Split a regular-grid child at source rectangle projections that reduce its
 * optimistic common-width cut capacity. This creates no routing assignments.
 * The caller supplies a preload-free domain; actual shared-edge geometry and
 * native per-net point eligibility remain downstream responsibilities.
 */
export const getFixedCopperNodeCuts = (params: {
  readonly node: CapacityMeshNode
  readonly context: FixedCopperNodeCutContext
  readonly maxNodeRatio?: number
}): FixedCopperNodeCuts => {
  const { node, context } = params
  if (!isOrdinaryPhysicalCutNode(node)) return { nodes: [node], cuts: [] }
  const minX = node.center.x - node.width / 2
  const minY = node.center.y - node.height / 2
  const maxX = node.center.x + node.width / 2
  const maxY = node.center.y + node.height / 2
  if (
    ![minX, minY, maxX, maxY, node.width, node.height].every(Number.isFinite) ||
    minX >= maxX ||
    minY >= maxY ||
    node.availableZ.length === 0
  ) {
    throw new Error(
      `Physical node cuts have invalid node ${node.capacityMeshNodeId}`,
    )
  }
  for (const z of node.availableZ) {
    if (!Number.isInteger(z) || z < 0 || z >= context.layerCount) {
      throw new Error(
        `Physical node cuts have an invalid layer in ${node.capacityMeshNodeId}`,
      )
    }
  }
  // The native source-to-region predicate includes a 0.001 boundary tolerance.
  // An inclusive expanded box is conservative at its rounded corners as well.
  if (
    Math.min(node.width, node.height) < MIN_CONNECTIVITY_BRIDGE_DIMENSION ||
    context.protectedPointIndex.search(
      minX - 0.001,
      minY - 0.001,
      maxX + 0.001,
      maxY + 0.001,
    ).length > 0
  ) {
    return { nodes: [node], cuts: [] }
  }
  const margin = context.traceWidth / 2 + context.padGap
  const queryBounds = [
    minX - margin,
    minY - margin,
    maxX + margin,
    maxY + margin,
  ]
  if (!queryBounds.every(Number.isFinite)) {
    throw new Error(
      `Physical node cuts cannot query bounds of ${node.capacityMeshNodeId}`,
    )
  }
  const nearby = context.rectangleIndex
    .search(minX - margin, minY - margin, maxX + margin, maxY + margin)
    .filter((entry): boolean =>
      entry.rectangle.zLayers.some((z): boolean => node.availableZ.includes(z)),
    )
  if (nearby.length === 0) return { nodes: [node], cuts: [] }
  const axis = node.height > node.width ? "y" : "x"
  const minimum = axis === "x" ? minX : minY
  const maximum = axis === "x" ? maxX : maxY
  const orthogonalSpan = axis === "x" ? node.height : node.width
  const hasRatioLimit =
    params.maxNodeRatio !== undefined &&
    Number.isFinite(params.maxNodeRatio) &&
    params.maxNodeRatio > 0
  const minimumChildLength = Math.max(
    MIN_CONNECTIVITY_BRIDGE_DIMENSION,
    hasRatioLimit ? orthogonalSpan / params.maxNodeRatio! : 0,
  )
  const coordinates = new Set<number>()
  for (const entry of nearby) {
    coordinates.add(axis === "x" ? entry.minX : entry.minY)
    coordinates.add(entry.rectangle.center[axis])
    coordinates.add(axis === "x" ? entry.maxX : entry.maxY)
  }
  const rectangles = nearby.map(
    (entry): FixedCopperRectangle => entry.rectangle,
  )
  const accepted: number[] = []
  let previous = minimum
  let unblockedCapacity: number | undefined
  const orderedCoordinates = [...coordinates].sort(
    (left, right): number => left - right,
  )
  for (const coordinate of orderedCoordinates) {
    const precedingLength = coordinate - previous
    const followingLength = maximum - coordinate
    if (
      precedingLength < minimumChildLength ||
      followingLength < minimumChildLength
    ) {
      continue
    }
    // Recheck the represented ratios too: division used to derive the minimum
    // length can round down at an exact aspect-ratio boundary.
    if (
      hasRatioLimit &&
      (Math.max(orthogonalSpan, precedingLength) /
        Math.min(orthogonalSpan, precedingLength) >
        params.maxNodeRatio! ||
        Math.max(orthogonalSpan, followingLength) /
          Math.min(orthogonalSpan, followingLength) >
          params.maxNodeRatio!)
    ) {
      continue
    }
    const start =
      axis === "x" ? { x: coordinate, y: minY } : { x: minX, y: coordinate }
    const end =
      axis === "x" ? { x: coordinate, y: maxY } : { x: maxX, y: coordinate }
    const input = {
      start,
      end,
      layerCount: context.layerCount,
      zLayers: node.availableZ,
      traceWidth: context.traceWidth,
      traceGap: context.traceGap,
      padGap: context.padGap,
      routableNetIds: context.routableNetIds,
      rectangles,
    }
    const constrained = getFixedCopperPortalSites(input)
    if (unblockedCapacity === undefined) {
      // Parallel cuts share the same varying-axis bounds and layer model.
      unblockedCapacity = getFixedCopperPortalSites({
        ...input,
        rectangles: [],
      }).totalCapacity
    }
    if (constrained.totalCapacity >= unblockedCapacity) continue
    accepted.push(coordinate)
    previous = coordinate
  }
  if (accepted.length === 0) return { nodes: [node], cuts: [] }
  const boundaries = [minimum, ...accepted, maximum]
  const nodes: CapacityMeshNode[] = []
  const cuts: PhysicalNodeCut[] = []
  for (let index = 0; index < boundaries.length - 1; index++) {
    const lower = boundaries[index]!
    const upper = boundaries[index + 1]!
    const centerCoordinate = lower + (upper - lower) / 2
    const child: CapacityMeshNode = {
      ...node,
      capacityMeshNodeId: `${node.capacityMeshNodeId}__physical_${axis}_${index}`,
      center: {
        x: axis === "x" ? centerCoordinate : node.center.x,
        y: axis === "y" ? centerCoordinate : node.center.y,
      },
      width: axis === "x" ? upper - lower : node.width,
      height: axis === "y" ? upper - lower : node.height,
      availableZ: [...node.availableZ],
    }
    const preceding = nodes.at(-1)
    if (preceding) {
      if (!areNodesBordering(preceding, child)) {
        throw new Error(
          `Physical node cut cannot represent adjacent children of ${node.capacityMeshNodeId}`,
        )
      }
      cuts.push({
        physicalCutId: `${node.capacityMeshNodeId}__physical_cut_${axis}_${index - 1}`,
        nodeIds: [preceding.capacityMeshNodeId, child.capacityMeshNodeId],
      })
    }
    nodes.push(child)
  }
  return { nodes, cuts }
}
