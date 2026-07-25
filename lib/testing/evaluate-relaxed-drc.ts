import {
  pointToSegmentClosestPoint,
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
} from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import {
  type Obstacle,
  type SimpleRouteJson,
  type SimplifiedPcbTrace,
  getConnectionPointLayers,
} from "lib/types"
import { getUniqueValidZLayersFromLayerNames } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { resolvePreloadedTraceCanonicalNetIds } from "lib/utils/resolvePreloadedTraceCanonicalNetIds"
import { RELAXED_DRC_OPTIONS } from "./drcPresets"
import {
  type GetDrcErrorsResult,
  VIA_OUTER_CLEARANCE_ERROR_PREFIX,
  getDrcErrors,
} from "./getDrcErrors"
import {
  type PcbViaWithContributingTraceIds,
  convertToCircuitJson,
} from "./utils/convertToCircuitJson"

/** Inputs used by the benchmark's relaxed DRC evaluation. */
export interface EvaluateRelaxedDrcInput {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
}

/** Benchmark relaxed DRC errors and the Circuit JSON evaluated to produce them. */
export interface EvaluateRelaxedDrcResult extends GetDrcErrorsResult {
  circuitJson: AnyCircuitElement[]
}

type CandidateViaOwnership = {
  outerDiameterTraceIds: string[]
  holeDiameterTraceIds: string[]
}

type Point = { x: number; y: number }

type LinearCopperPrimitive = {
  kind: "wire" | "through_pad"
  start: Point
  end: Point
  radius: number
  layers: Set<string>
}

type CopperPrimitive =
  | LinearCopperPrimitive
  | {
      kind: "via"
      center: Point
      radius: number
      layers: Set<string>
    }

type PhysicalTrace = {
  pcbTraceId: string
  canonicalNet: string
  primitives: CopperPrimitive[]
}

const VIA_DIMENSION_EPSILON = 1e-9
const PHYSICAL_CONNECTIVITY_EPSILON = 1e-6

const getViaLayerSet = (
  layerNames: readonly string[],
  layerCount: number,
): Set<string> => {
  const zLayers = getUniqueValidZLayersFromLayerNames(layerNames, layerCount)
  if (zLayers.length === 0) return new Set()
  const minimumZ = Math.min(...zLayers)
  const maximumZ = Math.max(...zLayers)
  return new Set(
    Array.from({ length: maximumZ - minimumZ + 1 }, (_, index) =>
      mapZToLayerName(minimumZ + index, layerCount),
    ),
  )
}

const getPhysicalTraces = (
  circuitJson: AnyCircuitElement[],
  layerCount: number,
): PhysicalTrace[] => {
  const viaPrimitivesByTraceId = new Map<string, CopperPrimitive[]>()
  for (const element of circuitJson) {
    if (element.type !== "pcb_via") continue
    const via = element as PcbViaWithContributingTraceIds
    const contributingTraceIds = [
      ...new Set([
        ...(via.contributing_pcb_trace_ids ?? []),
        ...(via.contributing_pcb_trace_via_dimensions ?? []).map(
          (contribution) => contribution.pcb_trace_id,
        ),
        ...(typeof via.pcb_trace_id === "string" ? [via.pcb_trace_id] : []),
      ]),
    ]
    const primitive: CopperPrimitive = {
      kind: "via",
      center: { x: via.x, y: via.y },
      radius: via.outer_diameter / 2,
      layers: getViaLayerSet(via.layers, layerCount),
    }
    for (const traceId of contributingTraceIds) {
      const primitives = viaPrimitivesByTraceId.get(traceId) ?? []
      primitives.push(primitive)
      viaPrimitivesByTraceId.set(traceId, primitives)
    }
  }

  return circuitJson.flatMap((element): PhysicalTrace[] => {
    if (
      element.type !== "pcb_trace" ||
      typeof element.pcb_trace_id !== "string" ||
      typeof element.source_trace_id !== "string"
    ) {
      return []
    }

    const primitives: CopperPrimitive[] = [
      ...(viaPrimitivesByTraceId.get(element.pcb_trace_id) ?? []),
    ]
    for (const routePoint of element.route) {
      if (routePoint.route_type === "wire") {
        primitives.push({
          kind: "wire",
          start: { x: routePoint.x, y: routePoint.y },
          end: { x: routePoint.x, y: routePoint.y },
          radius: routePoint.width / 2,
          layers: new Set([routePoint.layer]),
        })
      } else if (routePoint.route_type === "through_pad") {
        primitives.push({
          kind: "through_pad",
          start: routePoint.start,
          end: routePoint.end,
          radius: routePoint.width / 2,
          layers: getViaLayerSet(
            [routePoint.start_layer, routePoint.end_layer],
            layerCount,
          ),
        })
      }
    }
    for (let index = 0; index < element.route.length - 1; index += 1) {
      const start = element.route[index]
      const end = element.route[index + 1]
      if (
        start?.route_type !== "wire" ||
        end?.route_type !== "wire" ||
        start.layer !== end.layer
      ) {
        continue
      }
      primitives.push({
        kind: "wire",
        start: { x: start.x, y: start.y },
        end: { x: end.x, y: end.y },
        radius: Math.max(start.width, end.width) / 2,
        layers: new Set([start.layer]),
      })
    }

    return [
      {
        pcbTraceId: element.pcb_trace_id,
        canonicalNet: element.source_trace_id,
        primitives,
      },
    ]
  })
}

const layersOverlap = (a: Set<string>, b: Set<string>): boolean =>
  [...a].some((layer) => b.has(layer))

const isLinearCopperPrimitive = (
  primitive: CopperPrimitive,
): primitive is LinearCopperPrimitive => primitive.kind !== "via"

const primitivesTouch = (
  a: CopperPrimitive,
  b: CopperPrimitive,
  additionalClearance = 0,
): boolean => {
  if (!layersOverlap(a.layers, b.layers)) return false
  const maximumDistance =
    a.radius + b.radius + additionalClearance + PHYSICAL_CONNECTIVITY_EPSILON
  if (isLinearCopperPrimitive(a) && isLinearCopperPrimitive(b)) {
    return (
      segmentToSegmentMinDistance(a.start, a.end, b.start, b.end) <=
      maximumDistance
    )
  }
  if (isLinearCopperPrimitive(a) && b.kind === "via") {
    return pointToSegmentDistance(b.center, a.start, a.end) <= maximumDistance
  }
  if (a.kind === "via" && isLinearCopperPrimitive(b)) {
    return pointToSegmentDistance(a.center, b.start, b.end) <= maximumDistance
  }
  if (a.kind === "via" && b.kind === "via") {
    return (
      Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y) <=
      maximumDistance
    )
  }
  return false
}

const getLinearSegmentIntersection = (
  a: LinearCopperPrimitive,
  b: LinearCopperPrimitive,
): Point | undefined => {
  const aDelta = { x: a.end.x - a.start.x, y: a.end.y - a.start.y }
  const bDelta = { x: b.end.x - b.start.x, y: b.end.y - b.start.y }
  const denominator = aDelta.x * bDelta.y - aDelta.y * bDelta.x
  if (Math.abs(denominator) <= PHYSICAL_CONNECTIVITY_EPSILON) return undefined
  const startDelta = {
    x: b.start.x - a.start.x,
    y: b.start.y - a.start.y,
  }
  const aFraction =
    (startDelta.x * bDelta.y - startDelta.y * bDelta.x) / denominator
  const bFraction =
    (startDelta.x * aDelta.y - startDelta.y * aDelta.x) / denominator
  if (
    aFraction < -PHYSICAL_CONNECTIVITY_EPSILON ||
    aFraction > 1 + PHYSICAL_CONNECTIVITY_EPSILON ||
    bFraction < -PHYSICAL_CONNECTIVITY_EPSILON ||
    bFraction > 1 + PHYSICAL_CONNECTIVITY_EPSILON
  ) {
    return undefined
  }
  return {
    x: a.start.x + aFraction * aDelta.x,
    y: a.start.y + aFraction * aDelta.y,
  }
}

const getCopperOverlapCenter = (
  a: CopperPrimitive,
  b: CopperPrimitive,
): Point => {
  if (isLinearCopperPrimitive(a) && isLinearCopperPrimitive(b)) {
    const intersection = getLinearSegmentIntersection(a, b)
    if (intersection) return intersection
    const closestPairs = [
      [a.start, pointToSegmentClosestPoint(a.start, b.start, b.end)],
      [a.end, pointToSegmentClosestPoint(a.end, b.start, b.end)],
      [pointToSegmentClosestPoint(b.start, a.start, a.end), b.start],
      [pointToSegmentClosestPoint(b.end, a.start, a.end), b.end],
    ] as const
    const closestPair = closestPairs.reduce((best, pair) =>
      Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) <
      Math.hypot(best[0].x - best[1].x, best[0].y - best[1].y)
        ? pair
        : best,
    )
    return {
      x: (closestPair[0].x + closestPair[1].x) / 2,
      y: (closestPair[0].y + closestPair[1].y) / 2,
    }
  }
  if (isLinearCopperPrimitive(a) && b.kind === "via") {
    const closest = pointToSegmentClosestPoint(b.center, a.start, a.end)
    return { x: (closest.x + b.center.x) / 2, y: (closest.y + b.center.y) / 2 }
  }
  if (a.kind === "via" && isLinearCopperPrimitive(b)) {
    return getCopperOverlapCenter(b, a)
  }
  if (a.kind === "via" && b.kind === "via") {
    return {
      x: (a.center.x + b.center.x) / 2,
      y: (a.center.y + b.center.y) / 2,
    }
  }
  throw new Error("Unsupported copper primitive pair")
}

const getThroughPadCopperOverlapErrors = ({
  circuitJson,
  layerCount,
  rawErrors,
}: {
  circuitJson: AnyCircuitElement[]
  layerCount: number
  rawErrors: GetDrcErrorsResult["errors"]
}): GetDrcErrorsResult["errors"] => {
  const hasThroughPadCopper = circuitJson.some(
    (element) =>
      element.type === "pcb_trace" &&
      element.route.some(
        (routePoint) => routePoint.route_type === "through_pad",
      ),
  )
  if (!hasThroughPadCopper) return []

  const physicalTraces = getPhysicalTraces(circuitJson, layerCount)
  const rawOverlapIds = new Set(
    rawErrors.flatMap((error) =>
      "pcb_trace_error_id" in error &&
      typeof error.pcb_trace_error_id === "string"
        ? [error.pcb_trace_error_id]
        : [],
    ),
  )
  const errors: GetDrcErrorsResult["errors"] = []

  for (
    let traceAIndex = 0;
    traceAIndex < physicalTraces.length;
    traceAIndex += 1
  ) {
    const traceA = physicalTraces[traceAIndex]!
    for (
      let traceBIndex = traceAIndex + 1;
      traceBIndex < physicalTraces.length;
      traceBIndex += 1
    ) {
      const traceB = physicalTraces[traceBIndex]!
      if (
        traceA.pcbTraceId === traceB.pcbTraceId ||
        traceA.canonicalNet === traceB.canonicalNet
      ) {
        continue
      }
      const overlapId = `overlap_${traceA.pcbTraceId}_${traceB.pcbTraceId}`
      const reverseOverlapId = `overlap_${traceB.pcbTraceId}_${traceA.pcbTraceId}`
      if (rawOverlapIds.has(overlapId) || rawOverlapIds.has(reverseOverlapId)) {
        continue
      }

      let overlappingPrimitives: [CopperPrimitive, CopperPrimitive] | undefined
      for (const primitiveA of traceA.primitives) {
        for (const primitiveB of traceB.primitives) {
          if (
            primitiveA.kind !== "through_pad" &&
            primitiveB.kind !== "through_pad"
          ) {
            continue
          }
          if (
            primitivesTouch(
              primitiveA,
              primitiveB,
              RELAXED_DRC_OPTIONS.traceClearance ?? 0,
            )
          ) {
            overlappingPrimitives = [primitiveA, primitiveB]
            break
          }
        }
        if (overlappingPrimitives) break
      }
      if (!overlappingPrimitives) continue

      errors.push({
        type: "pcb_trace_error",
        error_type: "pcb_trace_error",
        pcb_trace_error_id: overlapId,
        pcb_trace_id: traceA.pcbTraceId,
        source_trace_id: traceA.canonicalNet,
        message: `PCB trace ${traceA.pcbTraceId} overlaps with ${traceB.pcbTraceId} through-pad copper (accidental contact)`,
        center: getCopperOverlapCenter(...overlappingPrimitives),
        pcb_component_ids: [],
        pcb_port_ids: [],
      })
    }
  }

  return errors
}

const rotatePointIntoObstacleCoordinates = (
  point: Point,
  obstacle: Obstacle,
): Point => {
  const radians = -((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const deltaX = point.x - obstacle.center.x
  const deltaY = point.y - obstacle.center.y
  return {
    x: deltaX * Math.cos(radians) - deltaY * Math.sin(radians),
    y: deltaX * Math.sin(radians) + deltaY * Math.cos(radians),
  }
}

const pointIsInsideObstacle = (point: Point, obstacle: Obstacle): boolean => {
  const localPoint = rotatePointIntoObstacleCoordinates(point, obstacle)
  return (
    Math.abs(localPoint.x) <= obstacle.width / 2 + 1e-9 &&
    Math.abs(localPoint.y) <= obstacle.height / 2 + 1e-9
  )
}

const primitiveTouchesObstacle = (
  primitive: CopperPrimitive,
  obstacle: Obstacle,
): boolean => {
  if (![...primitive.layers].some((layer) => obstacle.layers.includes(layer))) {
    return false
  }
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2

  if (primitive.kind === "via") {
    const localCenter = rotatePointIntoObstacleCoordinates(
      primitive.center,
      obstacle,
    )
    const deltaX = Math.max(Math.abs(localCenter.x) - halfWidth, 0)
    const deltaY = Math.max(Math.abs(localCenter.y) - halfHeight, 0)
    return (
      Math.hypot(deltaX, deltaY) <=
      primitive.radius + PHYSICAL_CONNECTIVITY_EPSILON
    )
  }

  const localStart = rotatePointIntoObstacleCoordinates(
    primitive.start,
    obstacle,
  )
  const localEnd = rotatePointIntoObstacleCoordinates(primitive.end, obstacle)
  if (
    (Math.abs(localStart.x) <= halfWidth &&
      Math.abs(localStart.y) <= halfHeight) ||
    (Math.abs(localEnd.x) <= halfWidth && Math.abs(localEnd.y) <= halfHeight)
  ) {
    return true
  }
  const corners = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ]
  return corners.some((corner, index) => {
    const nextCorner = corners[(index + 1) % corners.length]!
    return (
      segmentToSegmentMinDistance(localStart, localEnd, corner, nextCorner) <=
      primitive.radius + PHYSICAL_CONNECTIVITY_EPSILON
    )
  })
}

const primitiveTouchesTerminalPoint = (
  primitive: CopperPrimitive,
  point: Point,
  pointLayers: Set<string>,
): boolean => {
  if (!layersOverlap(primitive.layers, pointLayers)) return false
  if (isLinearCopperPrimitive(primitive)) {
    return (
      pointToSegmentDistance(point, primitive.start, primitive.end) <=
      primitive.radius + PHYSICAL_CONNECTIVITY_EPSILON
    )
  }
  return (
    Math.hypot(primitive.center.x - point.x, primitive.center.y - point.y) <=
    primitive.radius + PHYSICAL_CONNECTIVITY_EPSILON
  )
}

const getCanonicalConnectionName = (
  connection: SimpleRouteJson["connections"][number],
): string =>
  connection.__netConnectionName ??
  connection.__rootConnectionNames?.[0] ??
  connection.name

const getPrimitiveCenter = (primitive: CopperPrimitive): Point =>
  primitive.kind === "via"
    ? primitive.center
    : {
        x: (primitive.start.x + primitive.end.x) / 2,
        y: (primitive.start.y + primitive.end.y) / 2,
      }

const getPrimitiveDistanceToPoint = (
  primitive: CopperPrimitive,
  point: Point,
): number =>
  primitive.kind === "via"
    ? Math.max(
        0,
        Math.hypot(primitive.center.x - point.x, primitive.center.y - point.y) -
          primitive.radius,
      )
    : Math.max(
        0,
        pointToSegmentDistance(point, primitive.start, primitive.end) -
          primitive.radius,
      )

const getCombinedCopperContinuityErrors = ({
  inputSrj,
  srjWithPointPairs,
  circuitJson,
  candidateTraceIds,
  canonicalNetByTraceId,
}: {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  circuitJson: AnyCircuitElement[]
  candidateTraceIds: Set<string>
  canonicalNetByTraceId: Map<string, string>
}): GetDrcErrorsResult["errors"] => {
  const candidateTraceIdsByCanonicalNet = new Map<string, string[]>()
  for (const traceId of candidateTraceIds) {
    const canonicalNet = canonicalNetByTraceId.get(traceId)
    if (!canonicalNet) continue
    const owners = candidateTraceIdsByCanonicalNet.get(canonicalNet) ?? []
    owners.push(traceId)
    candidateTraceIdsByCanonicalNet.set(canonicalNet, owners)
  }

  const pointsByCanonicalNet = new Map<
    string,
    Array<{
      point: SimpleRouteJson["connections"][number]["pointsToConnect"][number]
      connection: SimpleRouteJson["connections"][number]
    }>
  >()
  for (const connection of inputSrj.connections) {
    const canonicalNet = getCanonicalConnectionName(connection)
    const points = pointsByCanonicalNet.get(canonicalNet) ?? []
    points.push(
      ...connection.pointsToConnect.map((point) => ({ point, connection })),
    )
    pointsByCanonicalNet.set(canonicalNet, points)
  }
  const expectedCanonicalNets = new Set<string>()
  for (const connection of srjWithPointPairs.connections) {
    const canonicalNet = getCanonicalConnectionName(connection)
    expectedCanonicalNets.add(canonicalNet)
    if (!pointsByCanonicalNet.has(canonicalNet)) {
      pointsByCanonicalNet.set(
        canonicalNet,
        connection.pointsToConnect.map((point) => ({ point, connection })),
      )
    }
  }
  const physicalTraces = getPhysicalTraces(circuitJson, inputSrj.layerCount)
  const errors: GetDrcErrorsResult["errors"] = []
  for (const canonicalNet of expectedCanonicalNets) {
    const ownerTraceIds =
      candidateTraceIdsByCanonicalNet.get(canonicalNet) ?? []
    const requiredPoints = pointsByCanonicalNet.get(canonicalNet) ?? []
    if (requiredPoints.length < 2) continue
    const netTraces = physicalTraces.filter(
      (trace) => trace.canonicalNet === canonicalNet,
    )

    const primitiveNodes = netTraces.flatMap((trace) =>
      trace.primitives.map((primitive) => ({
        primitive,
        pcbTraceId: trace.pcbTraceId,
      })),
    )
    const parentByPrimitiveIndex = primitiveNodes.map((_, index) => index)
    const findRoot = (primitiveIndex: number): number => {
      const parent = parentByPrimitiveIndex[primitiveIndex] ?? primitiveIndex
      if (parent === primitiveIndex) return primitiveIndex
      const root = findRoot(parent)
      parentByPrimitiveIndex[primitiveIndex] = root
      return root
    }
    const union = (primitiveAIndex: number, primitiveBIndex: number) => {
      const rootA = findRoot(primitiveAIndex)
      const rootB = findRoot(primitiveBIndex)
      if (rootA !== rootB) parentByPrimitiveIndex[rootB] = rootA
    }

    for (
      let primitiveAIndex = 0;
      primitiveAIndex < primitiveNodes.length;
      primitiveAIndex += 1
    ) {
      for (
        let primitiveBIndex = primitiveAIndex + 1;
        primitiveBIndex < primitiveNodes.length;
        primitiveBIndex += 1
      ) {
        if (
          primitivesTouch(
            primitiveNodes[primitiveAIndex]!.primitive,
            primitiveNodes[primitiveBIndex]!.primitive,
          )
        ) {
          union(primitiveAIndex, primitiveBIndex)
        }
      }
    }

    const touchedPrimitiveIndicesByRequiredPoint = requiredPoints.map(
      ({ point, connection }) => {
        const pointLayers = new Set(getConnectionPointLayers(point))
        const pointIdentityIds = new Set(
          [point.pointId, point.pcb_port_id].filter(
            (id): id is string => typeof id === "string",
          ),
        )
        const connectionIdentityIds = new Set([
          connection.name,
          connection.__netConnectionName,
          ...(connection.__rootConnectionNames ?? []),
          canonicalNet,
        ])
        const terminalObstacles = inputSrj.obstacles.filter((obstacle) => {
          if (
            !obstacle.layers.some((layer) => pointLayers.has(layer)) ||
            !pointIsInsideObstacle(point, obstacle)
          ) {
            return false
          }
          return obstacle.connectedTo.some(
            (id) => pointIdentityIds.has(id) || connectionIdentityIds.has(id),
          )
        })
        const touchedPrimitiveIndices = primitiveNodes.flatMap(
          ({ primitive }, primitiveIndex) =>
            primitiveTouchesTerminalPoint(primitive, point, pointLayers) ||
            terminalObstacles.some((obstacle) =>
              primitiveTouchesObstacle(primitive, obstacle),
            )
              ? [primitiveIndex]
              : [],
        )
        for (const primitiveIndex of touchedPrimitiveIndices.slice(1)) {
          union(touchedPrimitiveIndices[0]!, primitiveIndex)
        }
        return touchedPrimitiveIndices
      },
    )

    const referencePrimitiveIndex = touchedPrimitiveIndicesByRequiredPoint.find(
      (primitiveIndices) => primitiveIndices.length > 0,
    )?.[0]
    const disconnectedPointIndex =
      touchedPrimitiveIndicesByRequiredPoint.findIndex(
        (primitiveIndices) =>
          primitiveIndices.length === 0 ||
          (referencePrimitiveIndex !== undefined &&
            findRoot(primitiveIndices[0]!) !==
              findRoot(referencePrimitiveIndex)),
      )

    let disconnectedCandidatePrimitiveIndex = -1
    if (referencePrimitiveIndex !== undefined && disconnectedPointIndex < 0) {
      const referenceRoot = findRoot(referencePrimitiveIndex)
      disconnectedCandidatePrimitiveIndex = primitiveNodes.findIndex(
        (node, primitiveIndex) =>
          candidateTraceIds.has(node.pcbTraceId) &&
          findRoot(primitiveIndex) !== referenceRoot,
      )
    }
    if (
      referencePrimitiveIndex !== undefined &&
      disconnectedPointIndex < 0 &&
      disconnectedCandidatePrimitiveIndex < 0
    ) {
      continue
    }

    const disconnectedPoint =
      requiredPoints[Math.max(disconnectedPointIndex, 0)]?.point ??
      requiredPoints[0]!.point
    let candidateOwnerTraceIds: string[] = []
    let errorCenter: Point = {
      x: disconnectedPoint.x,
      y: disconnectedPoint.y,
    }
    let message = `Combined routed and preloaded copper for ${canonicalNet} is not physically contiguous`

    if (disconnectedCandidatePrimitiveIndex >= 0) {
      const disconnectedRoot = findRoot(disconnectedCandidatePrimitiveIndex)
      candidateOwnerTraceIds = [
        ...new Set(
          primitiveNodes.flatMap((node, primitiveIndex) =>
            candidateTraceIds.has(node.pcbTraceId) &&
            findRoot(primitiveIndex) === disconnectedRoot
              ? [node.pcbTraceId]
              : [],
          ),
        ),
      ]
      errorCenter = getPrimitiveCenter(
        primitiveNodes[disconnectedCandidatePrimitiveIndex]!.primitive,
      )
      message = `Candidate copper for ${canonicalNet} contains a fragment disconnected from its required terminals`
    } else if (primitiveNodes.length > 0) {
      const referenceRoot =
        referencePrimitiveIndex === undefined
          ? undefined
          : findRoot(referencePrimitiveIndex)
      candidateOwnerTraceIds = [
        ...new Set(
          primitiveNodes.flatMap((node, primitiveIndex) =>
            candidateTraceIds.has(node.pcbTraceId) &&
            (referenceRoot === undefined ||
              findRoot(primitiveIndex) !== referenceRoot)
              ? [node.pcbTraceId]
              : [],
          ),
        ),
      ]
      if (candidateOwnerTraceIds.length === 0) {
        const nearestCandidateNode = primitiveNodes
          .filter((node) => candidateTraceIds.has(node.pcbTraceId))
          .map((node) => ({
            node,
            distance: getPrimitiveDistanceToPoint(
              node.primitive,
              disconnectedPoint,
            ),
          }))
          .sort((left, right) => left.distance - right.distance)[0]?.node
        if (nearestCandidateNode) {
          candidateOwnerTraceIds = [nearestCandidateNode.pcbTraceId]
        }
      }
    }

    errors.push({
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      pcb_trace_error_id: `missing_connection_combined_${canonicalNet}`,
      pcb_trace_id:
        candidateOwnerTraceIds[0] ?? ownerTraceIds[0] ?? canonicalNet,
      source_trace_id: canonicalNet,
      message,
      center: errorCenter,
      pcb_component_ids: [],
      pcb_port_ids: requiredPoints.flatMap(({ point }) =>
        point.pcb_port_id ? [point.pcb_port_id] : [],
      ),
      candidate_pcb_trace_ids: candidateOwnerTraceIds,
    } as GetDrcErrorsResult["errors"][number])
  }

  return errors
}

const getCandidateViaOwnership = (
  via: PcbViaWithContributingTraceIds,
  candidateTraceIds: Set<string>,
): CandidateViaOwnership => {
  const contributions =
    via.contributing_pcb_trace_via_dimensions ??
    (typeof via.pcb_trace_id === "string"
      ? [
          {
            pcb_trace_id: via.pcb_trace_id,
            outer_diameter: via.outer_diameter,
            hole_diameter: via.hole_diameter,
          },
        ]
      : [])
  const fixedContributions = contributions.filter(
    (contribution) => !candidateTraceIds.has(contribution.pcb_trace_id),
  )
  const maximumFixedOuterDiameter = Math.max(
    Number.NEGATIVE_INFINITY,
    ...fixedContributions.map((contribution) => contribution.outer_diameter),
  )
  const maximumFixedHoleDiameter = Math.max(
    Number.NEGATIVE_INFINITY,
    ...fixedContributions.map((contribution) => contribution.hole_diameter),
  )
  const candidateContributions = contributions.filter((contribution) =>
    candidateTraceIds.has(contribution.pcb_trace_id),
  )

  return {
    outerDiameterTraceIds: [
      ...new Set(
        candidateContributions
          .filter(
            (contribution) =>
              contribution.outer_diameter >=
                via.outer_diameter - VIA_DIMENSION_EPSILON &&
              contribution.outer_diameter >
                maximumFixedOuterDiameter + VIA_DIMENSION_EPSILON,
          )
          .map((contribution) => contribution.pcb_trace_id),
      ),
    ],
    holeDiameterTraceIds: [
      ...new Set(
        candidateContributions
          .filter(
            (contribution) =>
              contribution.hole_diameter >=
                via.hole_diameter - VIA_DIMENSION_EPSILON &&
              contribution.hole_diameter >
                maximumFixedHoleDiameter + VIA_DIMENSION_EPSILON,
          )
          .map((contribution) => contribution.pcb_trace_id),
      ),
    ],
  }
}

const getCandidateContinuityOwnerTraceIds = (
  error: Record<string, unknown>,
  canonicalNetByTraceId: Map<string, string>,
  candidateTraceIdsByCanonicalNet: Map<string, string[]>,
): string[] => {
  if (Array.isArray(error.candidate_pcb_trace_ids)) {
    return error.candidate_pcb_trace_ids.filter(
      (traceId): traceId is string => typeof traceId === "string",
    )
  }
  if (
    typeof error.pcb_trace_error_id !== "string" ||
    !error.pcb_trace_error_id.startsWith("missing_connection_")
  ) {
    return []
  }

  const canonicalNet =
    typeof error.source_trace_id === "string"
      ? error.source_trace_id
      : typeof error.pcb_trace_id === "string"
        ? canonicalNetByTraceId.get(error.pcb_trace_id)
        : undefined
  return canonicalNet
    ? (candidateTraceIdsByCanonicalNet.get(canonicalNet) ?? [])
    : []
}

const isRawTraceContinuityError = (error: object): boolean => {
  const errorRecord = error as Record<string, unknown>
  return (
    typeof errorRecord.pcb_trace_error_id === "string" &&
    (errorRecord.pcb_trace_error_id.startsWith("missing_connection_") ||
      errorRecord.pcb_trace_error_id.startsWith("disconnected_endpoint_"))
  )
}

const isCombinedContinuityError = (error: Record<string, unknown>): boolean =>
  typeof error.pcb_trace_error_id === "string" &&
  error.pcb_trace_error_id.startsWith("missing_connection_combined_")

const getOtherCopperIdFromOverlapError = (
  error: Record<string, unknown>,
): string | undefined => {
  if (
    typeof error.pcb_trace_id !== "string" ||
    typeof error.pcb_trace_error_id !== "string"
  ) {
    return undefined
  }
  const prefix = `overlap_${error.pcb_trace_id}_`
  return error.pcb_trace_error_id.startsWith(prefix)
    ? error.pcb_trace_error_id.slice(prefix.length)
    : undefined
}

const createPreloadedTraceId = (
  originalId: string,
  index: number,
  usedTraceIds: Set<string>,
): string => {
  const baseId = `preloaded_${index}_${originalId}`
  let traceId = baseId
  let suffix = 1

  while (usedTraceIds.has(traceId)) {
    traceId = `${baseId}_${suffix}`
    suffix += 1
  }

  usedTraceIds.add(traceId)
  return traceId
}

/**
 * Adds fixed copper to the candidate traces while keeping Circuit JSON ids
 * unique. Fixed traces come first so a same-net coincident via retains fixed
 * ownership when Circuit JSON merges duplicate via geometry.
 */
export const createRelaxedDrcTraceSet = (
  inputSrj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
): SimplifiedPcbTrace[] => {
  const usedTraceIds = new Set(traces.map((trace) => trace.pcb_trace_id))
  const originalPreloadedTraces = inputSrj.traces ?? []
  const originalTraceIdCounts = new Map<string, number>()
  for (const trace of originalPreloadedTraces) {
    originalTraceIdCounts.set(
      trace.pcb_trace_id,
      (originalTraceIdCounts.get(trace.pcb_trace_id) ?? 0) + 1,
    )
  }
  const renamedPreloadedTraceIds = originalPreloadedTraces.map((trace, index) =>
    createPreloadedTraceId(trace.pcb_trace_id, index, usedTraceIds),
  )
  const canonicalNetIdByOriginalTraceId =
    resolvePreloadedTraceCanonicalNetIds(inputSrj)
  const preloadedTraceIdByOriginalId = new Map<string, string>()
  for (const [index, trace] of originalPreloadedTraces.entries()) {
    if (originalTraceIdCounts.get(trace.pcb_trace_id) !== 1) continue
    preloadedTraceIdByOriginalId.set(
      trace.pcb_trace_id,
      renamedPreloadedTraceIds[index]!,
    )
  }
  const preloadedTraces = originalPreloadedTraces.map((trace, index) => ({
    ...trace,
    connection_name:
      canonicalNetIdByOriginalTraceId.get(trace.pcb_trace_id) ??
      trace.connection_name,
    pcb_trace_id: renamedPreloadedTraceIds[index]!,
    ...(trace.connectsTo
      ? {
          connectsTo: trace.connectsTo.map(
            (connectedId) =>
              preloadedTraceIdByOriginalId.get(connectedId) ?? connectedId,
          ),
        }
      : {}),
  }))

  return [...preloadedTraces, ...traces]
}

const getCandidateViaPairOwnerTraceIds = (
  error: Record<string, unknown>,
  candidateViaOwnershipByViaId: Map<string, CandidateViaOwnership>,
): string[] => {
  if (!Array.isArray(error.pcb_via_ids)) return []
  const useOuterDiameter =
    typeof error.pcb_error_id === "string" &&
    error.pcb_error_id.startsWith(VIA_OUTER_CLEARANCE_ERROR_PREFIX)
  return [
    ...new Set(
      error.pcb_via_ids.flatMap((viaId) => {
        if (typeof viaId !== "string") return []
        const ownership = candidateViaOwnershipByViaId.get(viaId)
        return useOuterDiameter
          ? (ownership?.outerDiameterTraceIds ?? [])
          : (ownership?.holeDiameterTraceIds ?? [])
      }),
    ),
  ]
}

const errorInvolvesCandidateCopper = (
  error: Record<string, unknown>,
  candidateTraceIds: Set<string>,
  candidateViaOwnershipByViaId: Map<string, CandidateViaOwnership>,
  canonicalNetByTraceId: Map<string, string>,
  candidateTraceIdsByCanonicalNet: Map<string, string[]>,
): boolean => {
  if (isCombinedContinuityError(error)) {
    return true
  }
  if (
    typeof error.pcb_trace_id === "string" &&
    candidateTraceIds.has(error.pcb_trace_id)
  ) {
    return true
  }
  if (
    getCandidateContinuityOwnerTraceIds(
      error,
      canonicalNetByTraceId,
      candidateTraceIdsByCanonicalNet,
    ).length > 0
  ) {
    return true
  }
  if (
    typeof error.pcb_via_id === "string" &&
    (candidateViaOwnershipByViaId.get(error.pcb_via_id)?.outerDiameterTraceIds
      .length ?? 0) > 0
  ) {
    return true
  }
  if (
    getCandidateViaPairOwnerTraceIds(error, candidateViaOwnershipByViaId)
      .length > 0
  ) {
    return true
  }

  const otherCopperId = getOtherCopperIdFromOverlapError(error)
  return Boolean(
    otherCopperId &&
      (candidateTraceIds.has(otherCopperId) ||
        (candidateViaOwnershipByViaId.get(otherCopperId)?.outerDiameterTraceIds
          .length ?? 0) > 0),
  )
}

/** Converts routed and preloaded traces and evaluates the combined copper. */
export const evaluateRelaxedDrc = ({
  inputSrj,
  srjWithPointPairs,
  traces,
}: EvaluateRelaxedDrcInput): EvaluateRelaxedDrcResult => {
  const combinedTraces = createRelaxedDrcTraceSet(inputSrj, traces)
  const candidateTraceIds = new Set(traces.map((trace) => trace.pcb_trace_id))
  const preloadedTraceIds = new Set(
    combinedTraces
      .filter((trace) => !candidateTraceIds.has(trace.pcb_trace_id))
      .map((trace) => trace.pcb_trace_id),
  )
  const circuitJson = convertToCircuitJson(srjWithPointPairs, combinedTraces, {
    minTraceWidth: inputSrj.minTraceWidth,
    minViaDiameter: inputSrj.minViaDiameter,
    originalSrj: inputSrj,
    preloadedTraceIds,
  })
  const canonicalNetByTraceId = new Map<string, string>()
  const candidateTraceIdsByCanonicalNet = new Map<string, string[]>()
  for (const element of circuitJson) {
    if (
      element.type !== "pcb_trace" ||
      typeof element.pcb_trace_id !== "string" ||
      typeof element.source_trace_id !== "string"
    ) {
      continue
    }
    canonicalNetByTraceId.set(element.pcb_trace_id, element.source_trace_id)
    if (!candidateTraceIds.has(element.pcb_trace_id)) continue
    const candidateOwners =
      candidateTraceIdsByCanonicalNet.get(element.source_trace_id) ?? []
    candidateOwners.push(element.pcb_trace_id)
    candidateTraceIdsByCanonicalNet.set(
      element.source_trace_id,
      candidateOwners,
    )
  }
  const candidateViaOwnershipByViaId = new Map<string, CandidateViaOwnership>()
  for (const element of circuitJson) {
    if (element.type !== "pcb_via") continue
    const via = element as PcbViaWithContributingTraceIds
    const ownership = getCandidateViaOwnership(via, candidateTraceIds)
    if (
      ownership.outerDiameterTraceIds.length > 0 ||
      ownership.holeDiameterTraceIds.length > 0
    ) {
      candidateViaOwnershipByViaId.set(via.pcb_via_id, ownership)
    }
  }
  const drcResult = getDrcErrors(circuitJson, RELAXED_DRC_OPTIONS)
  const throughPadCopperOverlapErrors = getThroughPadCopperOverlapErrors({
    circuitJson,
    layerCount: inputSrj.layerCount,
    rawErrors: drcResult.errors,
  })
  const combinedCopperContinuityErrors = getCombinedCopperContinuityErrors({
    inputSrj,
    srjWithPointPairs,
    circuitJson,
    candidateTraceIds,
    canonicalNetByTraceId,
  })
  const shouldIncludeError = (error: object) =>
    errorInvolvesCandidateCopper(
      error as Record<string, unknown>,
      candidateTraceIds,
      candidateViaOwnershipByViaId,
      canonicalNetByTraceId,
      candidateTraceIdsByCanonicalNet,
    )
  const annotateCandidateTraceOwnership = <T extends object>(error: T): T => {
    const errorRecord = error as Record<string, unknown>
    const ownerTraceIds = new Set<string>()
    if (
      typeof errorRecord.pcb_trace_id === "string" &&
      candidateTraceIds.has(errorRecord.pcb_trace_id)
    ) {
      ownerTraceIds.add(errorRecord.pcb_trace_id)
    }
    for (const ownerTraceId of getCandidateContinuityOwnerTraceIds(
      errorRecord,
      canonicalNetByTraceId,
      candidateTraceIdsByCanonicalNet,
    )) {
      ownerTraceIds.add(ownerTraceId)
    }
    if (typeof errorRecord.pcb_via_id === "string") {
      for (const ownerTraceId of candidateViaOwnershipByViaId.get(
        errorRecord.pcb_via_id,
      )?.outerDiameterTraceIds ?? []) {
        ownerTraceIds.add(ownerTraceId)
      }
    }
    for (const ownerTraceId of getCandidateViaPairOwnerTraceIds(
      errorRecord,
      candidateViaOwnershipByViaId,
    )) {
      ownerTraceIds.add(ownerTraceId)
    }
    const otherCopperId = getOtherCopperIdFromOverlapError(errorRecord)
    if (otherCopperId) {
      if (candidateTraceIds.has(otherCopperId)) {
        ownerTraceIds.add(otherCopperId)
      }
      for (const ownerTraceId of candidateViaOwnershipByViaId.get(otherCopperId)
        ?.outerDiameterTraceIds ?? []) {
        ownerTraceIds.add(ownerTraceId)
      }
    }

    return ownerTraceIds.size > 0
      ? ({
          ...error,
          candidate_pcb_trace_ids: [...ownerTraceIds],
        } as T)
      : error
  }

  return {
    circuitJson,
    errors: [
      ...drcResult.errors.filter((error) => !isRawTraceContinuityError(error)),
      ...throughPadCopperOverlapErrors,
      ...combinedCopperContinuityErrors,
    ]
      .filter(shouldIncludeError)
      .map(annotateCandidateTraceOwnership),
    errorsWithCenters: [
      ...drcResult.errorsWithCenters.filter(
        (error) => !isRawTraceContinuityError(error),
      ),
      ...(throughPadCopperOverlapErrors as GetDrcErrorsResult["errorsWithCenters"]),
      ...(combinedCopperContinuityErrors as GetDrcErrorsResult["errorsWithCenters"]),
    ]
      .filter(shouldIncludeError)
      .map(annotateCandidateTraceOwnership),
    locationAwareErrors: [
      ...drcResult.locationAwareErrors.filter(
        (error) => !isRawTraceContinuityError(error),
      ),
      ...(throughPadCopperOverlapErrors as GetDrcErrorsResult["locationAwareErrors"]),
      ...(combinedCopperContinuityErrors as GetDrcErrorsResult["locationAwareErrors"]),
    ]
      .filter(shouldIncludeError)
      .map(annotateCandidateTraceOwnership),
  }
}
