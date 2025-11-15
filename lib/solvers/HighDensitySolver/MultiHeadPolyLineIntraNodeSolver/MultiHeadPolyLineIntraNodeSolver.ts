import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { HighDensityHyperParameters } from "../HighDensityHyperParameters"
import {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { GraphicsObject } from "graphics-debug"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { safeTransparentize } from "lib/solvers/colors"
import { getIntraNodeCrossings } from "lib/utils/getIntraNodeCrossings"
import {
  distance,
  doSegmentsIntersect,
  pointToSegmentDistance,
  segmentToSegmentMinDistance,
  pointToSegmentClosestPoint,
  distSq,
  clamp,
} from "@tscircuit/math-utils"
import { getPossibleInitialViaPositions } from "./getPossibleInitialViaPositions"
import { getEveryPossibleOrdering } from "./getEveryPossibleOrdering"
import { getEveryCombinationFromChoiceArray } from "./getEveryCombinationFromChoiceArray"
import { PolyLine, MHPoint, Candidate } from "./types1"
import { constructMiddlePointsWithViaPositions } from "./constructMiddlePointsWithViaPositions"
import { computeViaCountVariants } from "./computeViaCountVariants"
import { MHPoint2, PolyLine2 } from "./types2"
import { withinBounds } from "./withinBounds"
import { detectMultiConnectionClosedFacesWithoutVias } from "./detectMultiConnectionClosedFacesWithoutVias"

export class MultiHeadPolyLineIntraNodeSolver extends BaseSolver {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  hyperParameters: Partial<HighDensityHyperParameters>
  connMap?: ConnectivityMap
  candidates: Candidate[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  solvedRoutes: HighDensityIntraNodeRoute[] = []
  unsolvedConnections: any[] = []

  SEGMENTS_PER_POLYLINE: number

  cellSize: number

  MAX_CANDIDATES = 50e3

  viaDiameter: number = 0.6
  obstacleMargin: number = 0.1
  traceWidth: number = 0.15
  availableZ: number[] = []
  uniqueConnections: number = 0

  BOUNDARY_PADDING: number

  lastCandidate: Candidate | null = null

  maxViaCount: number
  minViaCount: number

  phase: "setup" | "solving" = "setup"
  progress = 0

  constructor(params: {
    nodeWithPortPoints: NodeWithPortPoints
    colorMap?: Record<string, string>
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
  }) {
    super()
    this.MAX_ITERATIONS = 10e3
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap =
      params.colorMap ??
      generateColorMapFromNodeWithPortPoints(params.nodeWithPortPoints)
    this.hyperParameters = params.hyperParameters ?? {}
    this.SEGMENTS_PER_POLYLINE =
      params.hyperParameters?.SEGMENTS_PER_POLYLINE ?? 3
    this.BOUNDARY_PADDING = params.hyperParameters?.BOUNDARY_PADDING ?? 0.05
    this.connMap = params.connMap

    // TODO swap with more sophisticated grid in SingleHighDensityRouteSolver
    this.cellSize = this.nodeWithPortPoints.width / 1024

    this.candidates = []
    this.availableZ = this.nodeWithPortPoints.availableZ ?? [0, 1]

    this.bounds = {
      minX:
        this.nodeWithPortPoints.center.x - this.nodeWithPortPoints.width / 2,
      maxX:
        this.nodeWithPortPoints.center.x + this.nodeWithPortPoints.width / 2,
      minY:
        this.nodeWithPortPoints.center.y - this.nodeWithPortPoints.height / 2,
      maxY:
        this.nodeWithPortPoints.center.y + this.nodeWithPortPoints.height / 2,
    }

    const areaInsideNode =
      this.nodeWithPortPoints.width * this.nodeWithPortPoints.height
    const areaPerVia =
      (this.viaDiameter + this.obstacleMargin * 2 + this.traceWidth / 2) ** 2

    const uniqueConnections = new Set(
      this.nodeWithPortPoints.portPoints.map((pp) => pp.connectionName),
    ).size
    this.uniqueConnections = uniqueConnections

    const { numSameLayerCrossings, numTransitions } = getIntraNodeCrossings(
      this.nodeWithPortPoints,
    )

    this.minViaCount = numSameLayerCrossings * 2 + numTransitions
    this.maxViaCount = Math.min(
      Math.floor(areaInsideNode / areaPerVia),
      Math.ceil(uniqueConnections * 1.5),
    )

    // if (uniqueConnections > 5) {
    //   this.failed = true
    //   this.error = `Limit is currently set to 6 unique connections, ${uniqueConnections} found`
    //   return
    // }

    if (
      this.minViaCount >
      this.SEGMENTS_PER_POLYLINE * (uniqueConnections / 2)
    ) {
      this.failed = true
      this.error = `Not possible to solve problem with given SEGMENTS_PER_POLYLINE (${this.SEGMENTS_PER_POLYLINE}), atleast ${this.minViaCount} vias are required`
      return
    }

    if (this.maxViaCount > this.SEGMENTS_PER_POLYLINE) {
      this.maxViaCount = this.SEGMENTS_PER_POLYLINE
    }

    if (this.maxViaCount < this.minViaCount) {
      this.maxViaCount = this.minViaCount
    }
  }

  /**
   * minGaps is a list of distances representing the "gap" between segments
   * on each layer.
   *
   * Each minGaps number represents the gap for a polyline pair, for example if
   * you have 3 polylines, you would have 3 minGaps...
   *
   * [ p1 -> p2 , p1 -> p3, p2 -> p3 ]
   */
  computeMinGapBtwPolyLines(polyLines: PolyLine2[]) {
    const minGaps = []
    const polyLineSegmentsByLayer: Array<Map<number, [MHPoint2, MHPoint2][]>> =
      []
    const polyLineVias: Array<MHPoint2[]> = []
    for (let i = 0; i < polyLines.length; i++) {
      const polyLine = polyLines[i]
      const path = [polyLine.start, ...polyLine.mPoints, polyLine.end]
      const segmentsByLayer: Map<number, [MHPoint2, MHPoint2][]> = new Map(
        this.availableZ.map((z) => [z, []]),
      )
      for (let i = 0; i < path.length - 1; i++) {
        const segment: [MHPoint2, MHPoint2] = [path[i], path[i + 1]]
        const layer = segment[0].z2
        if (!segmentsByLayer.has(layer)) {
          segmentsByLayer.set(layer, [])
        }
        segmentsByLayer.get(layer)!.push(segment)
      }
      polyLineSegmentsByLayer.push(segmentsByLayer)
      polyLineVias.push(path.filter((p) => p.z1 !== p.z2))
    }

    for (let i = 0; i < polyLines.length; i++) {
      const path1SegmentsByLayer = polyLineSegmentsByLayer[i]
      const path1Vias = polyLineVias[i]
      // Start j from i + 1 to compare distinct pairs only once
      for (let j = i + 1; j < polyLines.length; j++) {
        if (
          this.connMap?.areIdsConnected(
            polyLines[i].connectionName,
            polyLines[j].connectionName,
          )
        ) {
          continue
        }
        const path2SegmentsByLayer = polyLineSegmentsByLayer[j]
        const path2Vias = polyLineVias[j]

        let minGap = 1
        for (const zLayer of this.availableZ) {
          const path1Segments = path1SegmentsByLayer.get(zLayer) ?? []
          const path2Segments = path2SegmentsByLayer.get(zLayer) ?? []

          // SEGMENT TO SEGMENT DISTANCES
          for (const segment1 of path1Segments) {
            for (const segment2 of path2Segments) {
              minGap = Math.min(
                minGap,
                segmentToSegmentMinDistance(
                  segment1[0],
                  segment1[1],
                  segment2[0],
                  segment2[1],
                ) - this.traceWidth,
              )
            }
          }

          // VIA TO SEGMENT DISTANCES
          for (const via of path1Vias) {
            for (const segment of path2Segments) {
              minGap = Math.min(
                minGap,
                pointToSegmentDistance(via, segment[0], segment[1]) -
                  this.traceWidth / 2 -
                  this.viaDiameter / 2,
              )
            }
          }
          for (const via of path2Vias) {
            for (const segment of path1Segments) {
              minGap = Math.min(
                minGap,
                pointToSegmentDistance(via, segment[0], segment[1]) -
                  this.traceWidth / 2 -
                  this.viaDiameter / 2,
              )
            }
          }

          // VIA TO VIA DISTANCES
          for (const via1 of path1Vias) {
            for (const via2 of path2Vias) {
              minGap = Math.min(minGap, distance(via1, via2) - this.viaDiameter)
            }
          }
        }
        minGaps.push(minGap)
      }
    }
    return minGaps
  }

  insertCandidate(candidate: any) {
    // Binary search to find the correct position
    let low = 0
    let high = this.candidates.length - 1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      if (this.candidates[mid].f < candidate.f) {
        low = mid + 1
      } else {
        high = mid - 1
      }
    }
    this.candidates.splice(low, 0, candidate)
  }

  /**
   * Unlike most A* solvers with one initial candidate, we create a candidate
   * for each configuration of vias we want to test, this way when computing
   * neighbors we never consider changing layers
   */
  setupInitialPolyLines() {
    const portPairs: Map<string, { start: MHPoint; end: MHPoint }> = new Map()
    this.nodeWithPortPoints.portPoints.forEach((portPoint) => {
      if (!portPairs.has(portPoint.connectionName)) {
        portPairs.set(portPoint.connectionName, {
          start: {
            ...portPoint,
            z1: portPoint.z ?? 0,
            z2: portPoint.z ?? 0,
          },
          end: null as any,
        })
      } else {
        portPairs.get(portPoint.connectionName)!.end = {
          ...portPoint,
          z1: portPoint.z ?? 0,
          z2: portPoint.z ?? 0,
        }
      }
    })

    // Remove port pairs with only one point
    for (const [connectionName, portPair] of portPairs.entries()) {
      if (portPair.end === null) {
        portPairs.delete(connectionName)
      }
    }

    if (portPairs.size === 0) {
      this.failed = true
      this.error = "No port pairs found, can't solve"
      return
    }

    const portPairsEntries = Array.from(portPairs.entries())

    const viaCountVariants = computeViaCountVariants(
      portPairsEntries,
      this.SEGMENTS_PER_POLYLINE,
      this.maxViaCount,
      this.minViaCount,
    )

    const possibleViaPositions = getPossibleInitialViaPositions({
      portPairsEntries,
      viaCountVariants,
      bounds: this.bounds,
    })

    const possibleViaPositionsWithReorderings = []
    for (const { viaCountVariant, viaPositions } of possibleViaPositions) {
      const viaPositionsWithReorderings = getEveryPossibleOrdering(viaPositions)
      for (const viaPositions of viaPositionsWithReorderings) {
        possibleViaPositionsWithReorderings.push({
          viaCountVariant,
          viaPositions,
        })
      }
    }

    // MAJOR OPTIMIZATION ISSUE:
    // We currently generate a lot of redundant or invalid viaPositions because
    // we don't specify that only certain connectionNames should occupy a via
    // position. We later detect when there's a "single-layer closed face" and
    // discard these candidates- but they should never be generated! For 5
    // connections you can easily have 80,000 via position variants, with over
    // ~90% being invalid from empirical testing.

    // Convert the portPairs into PolyLines for the initial candidate
    for (const {
      viaPositions,
      viaCountVariant,
    } of possibleViaPositionsWithReorderings) {
      const polyLines: PolyLine[] = []
      let viaPositionIndicesUsed = 0
      for (let i = 0; i < portPairsEntries.length; i++) {
        const [connectionName, portPair] = portPairsEntries[i]
        const viaCount = viaCountVariant[i]
        const viaPositionsForPolyline = viaPositions.slice(
          viaPositionIndicesUsed,
          viaPositionIndicesUsed + viaCount,
        )
        const middlePoints = constructMiddlePointsWithViaPositions({
          start: portPair.start,
          end: portPair.end,
          segmentsPerPolyline: this.SEGMENTS_PER_POLYLINE,
          viaPositions: viaPositionsForPolyline,
          viaCount,
          availableZ: this.availableZ,
        })
        viaPositionIndicesUsed += viaCount

        polyLines.push({
          connectionName,
          start: portPair.start,
          end: portPair.end,
          mPoints: middlePoints,
        })
      }
      const hasClosedSameLayerFace =
        detectMultiConnectionClosedFacesWithoutVias(polyLines, this.bounds)

      if (hasClosedSameLayerFace) continue

      const minGaps = this.computeMinGapBtwPolyLines(polyLines)
      const h = this.computeH({ minGaps, forces: [] })
      const newCandidate = {
        polyLines,
        g: 0,
        h: h,
        f: h,
        viaCount: viaCountVariant.reduce((acc, count) => acc + count, 0),
        minGaps,
        // hasClosedSameLayerFace
      }

      if (this.checkIfSolved(newCandidate)) {
        this.candidates = [newCandidate]
        return
      }

      this.candidates.push(newCandidate)

      // NOTE: Might make sense to move this to ._step() so we can
      // keep generating
      if (this.candidates.length > this.MAX_CANDIDATES) {
        return
      }
    }
    this.candidates.sort((a, b) => a.f - b.f)
  }

  /**
   * g is the cost of each candidate, we consider complexity (deviation from
   * the straight line path for # of operations). This means g increases by
   * 1 from the parent for each operation
   */
  computeG(polyLines: PolyLine[], candidate: Candidate) {
    // return 0
    return candidate.g + 0.000005 + candidate.viaCount * 0.000005 * 100
  }

  /**
   * h is the heuristic cost of each candidate.
   */
  computeH(candidate: Pick<Candidate, "minGaps" | "forces">) {
    // Compute the total force magnitude
    let totalForceMagnitude = 0
    for (const force of candidate.forces ?? []) {
      for (const forceMap of force) {
        for (const force of forceMap.values()) {
          totalForceMagnitude += force.fx * force.fx + force.fy * force.fy
        }
      }
    }
    return totalForceMagnitude
  }

  getNeighbors(candidate: Candidate): Candidate[] {
    const { polyLines } = candidate
    const numPolyLines = polyLines.length
    const FORCE_MAGNITUDE = 0.02 // Tunable parameter for force strength
    const VIA_FORCE_MULTIPLIER = 2.0 // Vias push harder
    const INSIDE_VIA_FORCE_MULTIPLIER = 4.0 // Extra multiplier when inside a via
    const SEGMENT_FORCE_MULTIPLIER = 1.0
    // const FORCE_DECAY_RATE = 1.0 / this.cellSize // Controls how quickly force falls off with distance (adjust as needed)
    const FORCE_DECAY_RATE = 6
    const BOUNDARY_FORCE_STRENGTH = 0.008 // How strongly points are pushed back into bounds
    const EPSILON = 1e-6 // To avoid division by zero

    // 1. Initialize forces structure: forces[targetLineIdx][targetMPointIdx] = Map<sourceId, {fx, fy}>
    const forces: Array<Array<Map<string, { fx: number; fy: number }>>> =
      Array.from({ length: numPolyLines }, (_, i) =>
        Array.from({ length: polyLines[i].mPoints.length }, () => new Map()),
      )

    // Helper to add a specific force contribution to an mPoint if it exists
    const addForceContribution = (
      targetLineIndex: number,
      targetPointIndexInFullPath: number, // Index in [start, ...mPoints, end]
      sourceId: string, // Identifier for the source of the force
      fx: number,
      fy: number,
    ) => {
      // Only apply force if the target point is an mPoint (not start or end)
      if (
        targetPointIndexInFullPath > 0 &&
        targetPointIndexInFullPath <
          polyLines[targetLineIndex].mPoints.length + 1
      ) {
        const targetMPointIndex = targetPointIndexInFullPath - 1
        const forceMap = forces[targetLineIndex][targetMPointIndex]
        const existingForce = forceMap.get(sourceId) || { fx: 0, fy: 0 }
        forceMap.set(sourceId, {
          fx: existingForce.fx + fx,
          fy: existingForce.fy + fy,
        })
      }
    }

    // 2. Calculate forces between all pairs of polylines
    for (let i = 0; i < numPolyLines; i++) {
      for (let j = i + 1; j < numPolyLines; j++) {
        const polyLine1 = polyLines[i]
        const polyLine2 = polyLines[j]

        const points1 = [polyLine1.start, ...polyLine1.mPoints, polyLine1.end]
        const points2 = [polyLine2.start, ...polyLine2.mPoints, polyLine2.end]

        // Extract segments and vias for easier processing
        const segments1: Array<{
          p1: MHPoint
          p2: MHPoint
          layer: number
          p1Idx: number
          p2Idx: number
        }> = []
        const vias1: Array<{
          point: MHPoint
          layers: number[]
          index: number
        }> = []
        for (let k = 0; k < points1.length - 1; k++) {
          segments1.push({
            p1: points1[k],
            p2: points1[k + 1],
            layer: points1[k].z2,
            p1Idx: k,
            p2Idx: k + 1,
          })
        }
        points1.forEach((p, k) => {
          if (p.z1 !== p.z2)
            vias1.push({ point: p, layers: [p.z1, p.z2], index: k })
        })

        const segments2: Array<{
          p1: MHPoint
          p2: MHPoint
          layer: number
          p1Idx: number
          p2Idx: number
        }> = []
        const vias2: Array<{
          point: MHPoint
          layers: number[]
          index: number
        }> = []
        for (let k = 0; k < points2.length - 1; k++) {
          segments2.push({
            p1: points2[k],
            p2: points2[k + 1],
            layer: points2[k].z2,
            p1Idx: k,
            p2Idx: k + 1,
          })
        }
        points2.forEach((p, k) => {
          if (p.z1 !== p.z2)
            vias2.push({ point: p, layers: [p.z1, p.z2], index: k })
        })

        // --- Interaction Calculations ---

        // a) Segment <-> Segment
        for (const seg1 of segments1) {
          for (const seg2 of segments2) {
            if (seg1.layer === seg2.layer) {
              const minDist = segmentToSegmentMinDistance(
                seg1.p1,
                seg1.p2,
                seg2.p1,
                seg2.p2,
              )
              if (minDist < EPSILON) continue // Avoid division by zero if segments overlap significantly

              // Simple repulsive force based on center-to-center distance for now
              // TODO: A more sophisticated segment-segment force might be needed
              const center1 = {
                x: (seg1.p1.x + seg1.p2.x) / 2,
                y: (seg1.p1.y + seg1.p2.y) / 2,
              }
              const center2 = {
                x: (seg2.p1.x + seg2.p2.x) / 2,
                y: (seg2.p1.y + seg2.p2.y) / 2,
              }
              const dx = center1.x - center2.x
              const dy = center1.y - center2.y
              const dSq = dx * dx + dy * dy

              if (dSq > EPSILON) {
                const dist = Math.sqrt(dSq)
                // Exponential falloff: force = base * exp(-decay_rate * distance)
                const forceMag =
                  SEGMENT_FORCE_MULTIPLIER *
                  FORCE_MAGNITUDE *
                  Math.exp(-FORCE_DECAY_RATE * dist)
                const fx = (dx / dist) * forceMag
                const fy = (dy / dist) * forceMag

                // Add force contributions: seg2 (j) applies force to seg1 (i), seg1 (i) applies force to seg2 (j)
                const sourceIdSeg2 = `seg:${j}:${seg2.p1Idx}:${seg2.p2Idx}`
                const sourceIdSeg1 = `seg:${i}:${seg1.p1Idx}:${seg1.p2Idx}`

                // helper to process one endpoint against the opposite segment
                const endpointForce = (
                  ep: MHPoint,
                  epIdx: number,
                  otherSeg: {
                    p1: MHPoint
                    p2: MHPoint
                    p1Idx: number
                    p2Idx: number
                  },
                  targetLine: number,
                  oppLine: number,
                  srcIdOpp: string,
                  srcIdThis: string,
                ) => {
                  const cp = pointToSegmentClosestPoint(
                    ep,
                    otherSeg.p1,
                    otherSeg.p2,
                  )
                  const dx = ep.x - cp.x
                  const dy = ep.y - cp.y
                  const dSq = dx * dx + dy * dy
                  if (dSq <= EPSILON) return
                  const dist = Math.sqrt(dSq)
                  const mag =
                    SEGMENT_FORCE_MULTIPLIER *
                    FORCE_MAGNITUDE *
                    Math.exp(-FORCE_DECAY_RATE * dist)
                  const fx = (dx / dist) * mag
                  const fy = (dy / dist) * mag

                  // push this endpoint
                  addForceContribution(targetLine, epIdx, srcIdOpp, fx, fy)
                  // equal & opposite distributed onto the two endpoints of the other seg
                  addForceContribution(
                    oppLine,
                    otherSeg.p1Idx,
                    srcIdThis,
                    -fx / 2,
                    -fy / 2,
                  )
                  addForceContribution(
                    oppLine,
                    otherSeg.p2Idx,
                    srcIdThis,
                    -fx / 2,
                    -fy / 2,
                  )
                }

                // endpoints of s1 against s2
                endpointForce(
                  seg1.p1,
                  seg1.p1Idx,
                  seg2,
                  i,
                  j,
                  sourceIdSeg2,
                  sourceIdSeg1,
                )
                endpointForce(
                  seg1.p2,
                  seg1.p2Idx,
                  seg2,
                  i,
                  j,
                  sourceIdSeg2,
                  sourceIdSeg1,
                )
                // endpoints of s2 against s1
                endpointForce(
                  seg2.p1,
                  seg2.p1Idx,
                  seg1,
                  j,
                  i,
                  sourceIdSeg1,
                  sourceIdSeg2,
                )
                endpointForce(
                  seg2.p2,
                  seg2.p2Idx,
                  seg1,
                  j,
                  i,
                  sourceIdSeg1,
                  sourceIdSeg2,
                )
              }
            }
          }
        }

        // b) Via <-> Segment
        for (const via1 of vias1) {
          for (const seg2 of segments2) {
            if (via1.layers.includes(seg2.layer)) {
              const closestPointOnSeg = pointToSegmentClosestPoint(
                via1.point,
                seg2.p1,
                seg2.p2,
              )
              const dx = via1.point.x - closestPointOnSeg.x
              const dy = via1.point.y - closestPointOnSeg.y
              const dSq = dx * dx + dy * dy

              if (dSq > EPSILON) {
                const dist = Math.sqrt(dSq)
                let forceMultiplier = VIA_FORCE_MULTIPLIER
                let effectiveDistance = dist

                if (dist < this.viaDiameter / 2) {
                  // Point is inside the via radius
                  forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
                  // Use distance from center directly for decay calculation
                  effectiveDistance = Math.max(EPSILON, dist)
                } else {
                  // Point is outside the via radius
                  // Calculate distance from the edge
                  effectiveDistance = Math.max(
                    EPSILON,
                    dist - this.viaDiameter / 2,
                  )
                }

                // Force applied ONLY to the via (i) by the segment (j) - Exponential falloff
                const forceMag =
                  forceMultiplier *
                  FORCE_MAGNITUDE *
                  Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
                const fx_j_on_i = (dx / dist) * forceMag // Direction is still based on center-to-point vector
                const fy_j_on_i = (dy / dist) * forceMag
                const sourceIdSeg2 = `seg:${j}:${seg2.p1Idx}:${seg2.p2Idx}`
                addForceContribution(
                  i,
                  via1.index,
                  sourceIdSeg2,
                  fx_j_on_i,
                  fy_j_on_i,
                )
                // Force from via1 (i) onto seg2 (j) - Apply opposite force to segment endpoints
                const sourceIdVia1 = `via:${i}:${via1.index}`
                addForceContribution(
                  j,
                  seg2.p1Idx,
                  sourceIdVia1,
                  -fx_j_on_i / 2,
                  -fy_j_on_i / 2,
                )
                addForceContribution(
                  j,
                  seg2.p2Idx,
                  sourceIdVia1,
                  -fx_j_on_i / 2,
                  -fy_j_on_i / 2,
                )
              }
            }
          }
        }
        for (const via2 of vias2) {
          for (const seg1 of segments1) {
            if (via2.layers.includes(seg1.layer)) {
              const closestPointOnSeg = pointToSegmentClosestPoint(
                via2.point,
                seg1.p1,
                seg1.p2,
              )
              const dx = via2.point.x - closestPointOnSeg.x
              const dy = via2.point.y - closestPointOnSeg.y
              const dSq = dx * dx + dy * dy

              if (dSq > EPSILON) {
                const dist = Math.sqrt(dSq)
                let forceMultiplier = VIA_FORCE_MULTIPLIER
                let effectiveDistance = dist

                if (dist < this.viaDiameter / 2) {
                  // Point is inside the via radius
                  forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
                  // Use distance from center directly for decay calculation
                  effectiveDistance = Math.max(EPSILON, dist)
                } else {
                  // Point is outside the via radius
                  // Calculate distance from the edge
                  effectiveDistance = Math.max(
                    EPSILON,
                    dist - this.viaDiameter / 2,
                  )
                }

                // Force applied ONLY to the via (j) by the segment (i) - Exponential falloff
                const forceMag =
                  forceMultiplier *
                  FORCE_MAGNITUDE *
                  Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
                const fx_i_on_j = (dx / dist) * forceMag // Direction is still based on center-to-point vector
                const fy_i_on_j = (dy / dist) * forceMag
                const sourceIdSeg1 = `seg:${i}:${seg1.p1Idx}:${seg1.p2Idx}`
                addForceContribution(
                  j,
                  via2.index,
                  sourceIdSeg1,
                  fx_i_on_j,
                  fy_i_on_j,
                )
                // Force from via2 (j) onto seg1 (i) - Apply opposite force to segment endpoints
                const sourceIdVia2 = `via:${j}:${via2.index}`
                addForceContribution(
                  i,
                  seg1.p1Idx,
                  sourceIdVia2,
                  -fx_i_on_j / 2,
                  -fy_i_on_j / 2,
                )
                addForceContribution(
                  i,
                  seg1.p2Idx,
                  sourceIdVia2,
                  -fx_i_on_j / 2,
                  -fy_i_on_j / 2,
                )
              }
            }
          }
        }

        // c) Via <-> Via
        for (const via1 of vias1) {
          for (const via2 of vias2) {
            const commonLayers = via1.layers.filter((z) =>
              via2.layers.includes(z),
            )
            if (commonLayers.length > 0) {
              const dx = via1.point.x - via2.point.x
              const dy = via1.point.y - via2.point.y
              const dSq = dx * dx + dy * dy

              if (dSq > EPSILON) {
                const dist = Math.sqrt(dSq)
                let forceMultiplier = VIA_FORCE_MULTIPLIER
                let effectiveDistance = dist

                if (dist < this.viaDiameter) {
                  // Vias overlap
                  forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
                  // Use center-to-center distance directly for decay calculation
                  effectiveDistance = Math.max(EPSILON, dist)
                } else {
                  // Vias do not overlap
                  // Calculate distance between edges
                  effectiveDistance = Math.max(EPSILON, dist - this.viaDiameter)
                }

                // Exponential falloff
                const forceMag =
                  forceMultiplier *
                  FORCE_MAGNITUDE *
                  Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
                const fx_j_on_i = (dx / dist) * forceMag // Force applied by via2 (j) onto via1 (i)
                const fy_j_on_i = (dy / dist) * forceMag
                const sourceIdVia2 = `via:${j}:${via2.index}`
                const sourceIdVia1 = `via:${i}:${via1.index}`
                addForceContribution(
                  i,
                  via1.index,
                  sourceIdVia2,
                  fx_j_on_i,
                  fy_j_on_i,
                )
                addForceContribution(
                  j,
                  via2.index,
                  sourceIdVia1,
                  -fx_j_on_i,
                  -fy_j_on_i,
                ) // Force applied by via1 (i) onto via2 (j)
              }
            }
          }
        }
      }
    }

    // 2.5 Calculate forces between vias WITHIN the SAME polyline
    for (let i = 0; i < numPolyLines; i++) {
      const polyLine = polyLines[i]
      const points = [polyLine.start, ...polyLine.mPoints, polyLine.end]
      const vias: Array<{ point: MHPoint; layers: number[]; index: number }> =
        []
      points.forEach((p, k) => {
        if (p.z1 !== p.z2)
          vias.push({ point: p, layers: [p.z1, p.z2], index: k })
      })

      if (vias.length < 2) continue // Need at least two vias to interact

      for (let v1Idx = 0; v1Idx < vias.length; v1Idx++) {
        for (let v2Idx = v1Idx + 1; v2Idx < vias.length; v2Idx++) {
          const via1 = vias[v1Idx]
          const via2 = vias[v2Idx]

          // Vias on the same polyline always interact (repel) regardless of layer
          const dx = via1.point.x - via2.point.x
          const dy = via1.point.y - via2.point.y
          const dSq = dx * dx + dy * dy

          if (dSq > EPSILON) {
            const dist = Math.sqrt(dSq)
            let forceMultiplier = VIA_FORCE_MULTIPLIER
            let effectiveDistance = dist

            if (dist < this.viaDiameter) {
              // Vias overlap
              forceMultiplier *= INSIDE_VIA_FORCE_MULTIPLIER // Apply stronger force
              effectiveDistance = Math.max(EPSILON, dist)
            } else {
              // Vias do not overlap
              effectiveDistance = Math.max(EPSILON, dist - this.viaDiameter)
            }

            // Exponential falloff
            const forceMag =
              forceMultiplier *
              FORCE_MAGNITUDE *
              Math.exp(-FORCE_DECAY_RATE * effectiveDistance)
            const fx_2_on_1 = (dx / dist) * forceMag // Force applied by via2 onto via1
            const fy_2_on_1 = (dy / dist) * forceMag
            const sourceIdVia2 = `via:${i}:${via2.index}` // Source is via2 on line i
            const sourceIdVia1 = `via:${i}:${via1.index}` // Source is via1 on line i

            // Apply force from via2 onto via1 (both on line i)
            addForceContribution(
              i,
              via1.index,
              sourceIdVia2,
              fx_2_on_1,
              fy_2_on_1,
            )
            // Apply force from via1 onto via2 (both on line i) - opposite direction
            addForceContribution(
              i,
              via2.index,
              sourceIdVia1,
              -fx_2_on_1,
              -fy_2_on_1,
            )
          }
        }
      }
    }

    // 3. Apply forces and create the new neighbor candidate
    // Deep clone polylines to modify them
    const newPolyLines = polyLines.map((pl) => ({
      ...pl,
      mPoints: pl.mPoints.map((mp) => ({ ...mp })),
    }))

    let pointsMoved = false
    for (let i = 0; i < numPolyLines; i++) {
      for (let k = 0; k < newPolyLines[i].mPoints.length; k++) {
        const mPoint = newPolyLines[i].mPoints[k]
        const forceMap = forces[i][k]

        // Calculate the net force by summing contributions
        const netForce = { fx: 0, fy: 0 }
        for (const force of forceMap.values()) {
          netForce.fx += force.fx
          netForce.fy += force.fy
        }

        const isVia = mPoint.z1 !== mPoint.z2
        let newX = mPoint.x + netForce.fx
        let newY = mPoint.y + netForce.fy

        if (isVia) {
          // Apply exponential boundary force ONLY to vias
          const radius = this.viaDiameter / 2
          let boundaryForceX = 0
          let boundaryForceY = 0

          // Use a margin appropriate for vias pushing away from the edge
          const baseForceMargin = this.viaDiameter / 2 // Or perhaps obstacleMargin
          const forceMargin = baseForceMargin + this.BOUNDARY_PADDING

          const minX = this.bounds.minX + forceMargin
          const maxX = this.bounds.maxX - forceMargin
          const minY = this.bounds.minY + forceMargin
          const maxY = this.bounds.maxY - forceMargin

          const distOutsideMinX = minX + radius - mPoint.x // How far the via *center* is past the allowed edge
          const distOutsideMaxX = mPoint.x - (maxX - radius)
          const distOutsideMinY = minY + radius - mPoint.y
          const distOutsideMaxY = mPoint.y - (maxY - radius)

          if (distOutsideMinX > 0) {
            boundaryForceX =
              BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMinX / (this.obstacleMargin * 2)) - 1)
          } else if (distOutsideMaxX > 0) {
            boundaryForceX =
              -BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMaxX / (this.obstacleMargin * 2)) - 1)
          }

          if (distOutsideMinY > 0) {
            boundaryForceY =
              BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMinY / (this.obstacleMargin * 2)) - 1)
          } else if (distOutsideMaxY > 0) {
            boundaryForceY =
              -BOUNDARY_FORCE_STRENGTH *
              (Math.exp(distOutsideMaxY / (this.obstacleMargin * 2)) - 1)
          }

          // Add boundary force to net force and recalculate potential position
          netForce.fx += boundaryForceX
          netForce.fy += boundaryForceY
          newX = mPoint.x + netForce.fx
          newY = mPoint.y + netForce.fy

          // Optional: Clamp via position as a hard stop if force isn't enough?
          // newX = Math.max(this.bounds.minX + radius, Math.min(this.bounds.maxX - radius, newX));
          // newY = Math.max(this.bounds.minY + radius, Math.min(this.bounds.maxY - radius, newY));
        } else {
          // For regular points, CLAMP position to bounds + traceWidth/2 padding
          const basePadding = this.traceWidth / 2
          const padding = basePadding + this.BOUNDARY_PADDING
          newX = Math.max(
            this.bounds.minX + padding,
            Math.min(this.bounds.maxX - padding, newX),
          )
          newY = Math.max(
            this.bounds.minY + padding,
            Math.min(this.bounds.maxY - padding, newY),
          )
        }

        // Dampen force? Add friction? (Optional) - Applied before clamping/boundary force

        if (
          Math.abs(netForce.fx) < EPSILON &&
          Math.abs(netForce.fy) < EPSILON
        ) {
          continue // No significant net force, skip update
        }

        // Limit maximum movement per step? (Optional)
        // const maxMove = this.cellSize;
        // const forceMag = Math.sqrt(netForce.fx * netForce.fx + netForce.fy * netForce.fy);
        // Update position if moved significantly from original position
        // Use the calculated (and potentially clamped/boundary-forced) newX, newY
        if (
          Math.abs(mPoint.x - newX) > EPSILON ||
          Math.abs(mPoint.y - newY) > EPSILON
        ) {
          mPoint.x = newX
          mPoint.y = newY
          pointsMoved = true
        }
      }
    }

    // If no points moved significantly, don't generate a redundant neighbor
    if (!pointsMoved) {
      // console.log("No points moved significantly, skipping neighbor generation.");
      return []
    }

    const minGaps = this.computeMinGapBtwPolyLines(newPolyLines)
    const g = this.computeG(newPolyLines, candidate) // G might represent something else now, e.g., total displacement or just step count
    const h = this.computeH({ minGaps, forces })
    const newNeighbor: Candidate = {
      polyLines: newPolyLines,
      g,
      h,
      // The rounding of g is for fun animations (prevents flashing btw multiple candidate paths)
      f: Math.round(g * 5) / 5 + h,
      minGaps,
      forces: forces, // Store the calculated forces
      viaCount: candidate.viaCount,
    }

    // console.log(`Generated neighbor ${neighborHash.substring(0, 10)}... f=${newNeighbor.f.toFixed(3)}`);

    return [newNeighbor]
  }

  checkIfSolved(candidate: Pick<Candidate, "polyLines" | "minGaps">) {
    const minGapsToOtherConnectionsValid = candidate.minGaps.every(
      (minGap) => minGap >= this.obstacleMargin,
    )

    const allPointsWithinBounds = candidate.polyLines.every((polyLine) => {
      return polyLine.mPoints.every((mPoint) => {
        const basePadding =
          mPoint.z1 !== mPoint.z2 ? this.viaDiameter / 2 : this.traceWidth / 2
        const padding = basePadding + this.BOUNDARY_PADDING
        return withinBounds(mPoint, this.bounds, padding)
      })
    })

    return minGapsToOtherConnectionsValid && allPointsWithinBounds
  }

  // ------------------------------------------------------------------
  //  Try accepting the best candidate even if normal solving failed.
  // ------------------------------------------------------------------
  tryFinalAcceptance() {
    const minGapTarget =
      this.hyperParameters?.MINIMUM_FINAL_ACCEPTANCE_GAP ?? undefined
    if (
      minGapTarget === undefined ||
      this.lastCandidate === null ||
      this.lastCandidate.minGaps.length === 0
    )
      return

    // take the smallest layer-to-layer gap of the last explored candidate
    const minGapAchieved = Math.min(...this.lastCandidate.minGaps)
    if (minGapAchieved >= minGapTarget) {
      // Accept this imperfect but good-enough solution
      this.solved = true
      this._setSolvedRoutes()
      return
    }
    return
  }

  _step() {
    if (this.phase === "setup") {
      this.setupInitialPolyLines()
      this.phase = "solving"
      return
    }
    const currentCandidate = this.candidates.shift()
    if (!currentCandidate) {
      this.tryFinalAcceptance()
      if (this.solved) return
      this.failed = true
      this.error = "No candidates left"
      return
    }
    this.lastCandidate = currentCandidate
    if (this.checkIfSolved(currentCandidate)) {
      this.solved = true
      this._setSolvedRoutes()
      return
    }
    if (!currentCandidate) {
      this.failed = true
      return
    }
    const neighbors = this.getNeighbors(currentCandidate)
    for (const neighbor of neighbors) {
      this.insertCandidate(neighbor)
    }
  }

  visualize(): GraphicsObject {
    const graphicsObject: GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles"> =
      {
        points: [],
        lines: [],
        rects: [],
        circles: [],
        coordinateSystem: "cartesian",
        title: "MultiHeadPolyLineIntraNodeSolver Visualization",
      }

    // Draw node bounds
    graphicsObject.lines.push({
      points: [
        { x: this.bounds.minX, y: this.bounds.minY },
        { x: this.bounds.maxX, y: this.bounds.minY },
        { x: this.bounds.maxX, y: this.bounds.maxY },
        { x: this.bounds.minX, y: this.bounds.maxY },
        { x: this.bounds.minX, y: this.bounds.minY },
      ],
      strokeColor: "gray",
    })

    // Visualize the polylines from the last evaluated candidate (or initial if none evaluated)
    const candidateToVisualize = this.lastCandidate ?? this.candidates[0]

    // Add indicator for closed face
    if (candidateToVisualize?.hasClosedSameLayerFace) {
      const rectWidth = (this.bounds.maxX - this.bounds.minX) * 0.1
      const rectHeight = (this.bounds.maxY - this.bounds.minY) * 0.1
      graphicsObject.rects.push({
        center: {
          x: this.bounds.maxX + rectWidth * 0.6, // Position slightly outside top-right
          y: this.bounds.maxY + rectHeight * 0.6,
        },
        width: rectWidth,
        height: rectHeight,
        fill: "red",
        label: "HAS CLOSED FACE",
      })
    }

    // Draw input port points
    for (const pt of this.nodeWithPortPoints.portPoints) {
      graphicsObject.points.push({
        x: pt.x,
        y: pt.y,
        // Assuming port points represent a single layer entry/exit, use z or default to 0
        label: `${pt.connectionName} (Port z=${pt.z ?? 0})`,
        color: this.colorMap[pt.connectionName] ?? "blue",
      })
    }

    // Visualize the polylines (if a candidate exists)
    if (candidateToVisualize) {
      candidateToVisualize.polyLines.forEach((polyLine, polyLineIndex) => {
        const color = this.colorMap[polyLine.connectionName] ?? "purple"
        const pointsInPolyline = [
          polyLine.start,
          ...polyLine.mPoints,
          polyLine.end,
        ]

        // Draw segments of the polyline
        for (let i = 0; i < pointsInPolyline.length - 1; i++) {
          const p1 = pointsInPolyline[i] // Point where segment starts (or via ends)
          const p2 = pointsInPolyline[i + 1] // Point where segment ends (or via starts)

          // A segment exists between p1 and p2 on layer p1.z2 (layer after p1's potential via)
          // which should be the same as p2.z1 (layer before p2's potential via)
          // If p1.z2 !== p2.z1, something is wrong in the data structure.
          const segmentLayer = p1.z2
          const isLayer0 = segmentLayer === 0
          const segmentColor = isLayer0 ? color : safeTransparentize(color, 0.5)

          graphicsObject.lines.push({
            points: [p1, p2],
            strokeColor: segmentColor,
            strokeWidth: this.traceWidth, // TODO: Use actual trace thickness from HighDensityRoute?
            strokeDash: !isLayer0 ? [0.15, 0.15] : undefined, // Dashed for layers > 0
            label: `${polyLine.connectionName} segment (z=${segmentLayer})`,
          })
        }

        // Draw points (start, mPoints, end) and Vias
        pointsInPolyline.forEach((point, pointIndex) => {
          const isVia = point.z1 !== point.z2
          const pointLayer = point.z1 // Layer before potential via
          const isMPoint =
            pointIndex > 0 && pointIndex < pointsInPolyline.length - 1

          let label = ""
          let forceLabel = ""

          if (isMPoint) {
            const mPointIndex = pointIndex - 1
            const forceMap =
              candidateToVisualize.forces?.[polyLineIndex]?.[mPointIndex]

            if (forceMap && forceMap.size > 0) {
              const netForce = { fx: 0, fy: 0 }
              forceMap.forEach((force, sourceId) => {
                netForce.fx += force.fx
                netForce.fy += force.fy

                if (Math.abs(force.fx) > 1e-6 || Math.abs(force.fy) > 1e-6) {
                  const parts = sourceId.split(":")
                  const sourceType = parts[0] // "via" or "seg"
                  const applyingLineIndex = parseInt(parts[1], 10)
                  const applyingPolyline =
                    candidateToVisualize.polyLines[applyingLineIndex]
                  const applyingColor =
                    this.colorMap[applyingPolyline.connectionName] ?? "gray"
                  const forceScale = 20 // Adjust scale for visibility
                  const forceEndPoint = {
                    x: point.x + force.fx * forceScale,
                    y: point.y + force.fy * forceScale,
                  }

                  let sourceLabel = applyingPolyline.connectionName
                  if (sourceType === "via") {
                    const pointIdx = parseInt(parts[2], 10)
                    sourceLabel += ` Via ${pointIdx}`
                  } else if (sourceType === "seg") {
                    const p1Idx = parseInt(parts[2], 10)
                    const p2Idx = parseInt(parts[3], 10)
                    sourceLabel += ` Seg ${p1Idx}-${p2Idx}`
                  }

                  graphicsObject.lines.push({
                    points: [point, forceEndPoint],
                    strokeColor: applyingColor, // Color by applying polyline
                    strokeWidth: 0.02,
                    strokeDash: "2,2", // Dashed line for force
                    label: `Force by ${sourceLabel} on ${polyLine.connectionName} mPoint ${mPointIndex}`,
                  })
                }
              })
              // Update the label to show the net force
              if (
                Math.abs(netForce.fx) > 1e-6 ||
                Math.abs(netForce.fy) > 1e-6
              ) {
                forceLabel = `\nNet Force: (${netForce.fx.toFixed(3)}, ${netForce.fy.toFixed(3)})`
              }
            }
          }

          if (isVia) {
            // Draw Via
            label = `Via (${polyLine.connectionName} z=${point.z1} -> z=${point.z2})${forceLabel}`
            graphicsObject.circles.push({
              center: point,
              radius: this.viaDiameter / 2,
              fill: safeTransparentize(color, 0.5), // Distinct Via color
              label: label,
            })
          } else {
            // Draw regular point (only draw mPoints for clarity, start/end are ports)
            if (isMPoint) {
              const isLayer0 = pointLayer === 0
              // Regular mPoint (not a via)
              // const isLayer0 = pointLayer === 0 // Removed duplicate declaration
              const pointColor = isLayer0
                ? color
                : safeTransparentize(color, 0.5)
              label = `mPoint (${polyLine.connectionName} z=${pointLayer})${forceLabel}`

              // Draw the circle for the mPoint itself
              graphicsObject.circles.push({
                center: point,
                radius: this.cellSize / 8, // Smaller circle for mPoints
                fill: pointColor,
                label: label,
              })
            }
            // Start/End points are visualized by the port points loop earlier
          }
        })
      })
    }

    return graphicsObject
  }

  _setSolvedRoutes() {
    if (!this.solved || !this.lastCandidate) {
      return []
    }

    const solvedRoutes: HighDensityIntraNodeRoute[] = []

    for (const polyLine of this.lastCandidate.polyLines) {
      const routePoints: Array<{ x: number; y: number; z: number }> = []
      const vias: Array<{ x: number; y: number }> = []
      const fullPath = [polyLine.start, ...polyLine.mPoints, polyLine.end]

      for (let i = 0; i < fullPath.length; i++) {
        const currentPoint = fullPath[i]

        // Add the point on its starting layer (z1)
        routePoints.push({
          x: currentPoint.x,
          y: currentPoint.y,
          z: currentPoint.z1,
        })

        // If it's a via (layer transition)
        if (currentPoint.z1 !== currentPoint.z2) {
          // Add the via location
          vias.push({ x: currentPoint.x, y: currentPoint.y })
          // Add the point again on the ending layer (z2)
          // This creates the vertical segment in the route representation
          routePoints.push({
            x: currentPoint.x,
            y: currentPoint.y,
            z: currentPoint.z2,
          })
        }
      }

      // TODO: Optimize the route points (remove collinear points on the same layer)

      solvedRoutes.push({
        connectionName: polyLine.connectionName,
        traceThickness: this.traceWidth,
        viaDiameter: this.viaDiameter,
        route: routePoints,
        vias: vias,
      })
    }

    this.solvedRoutes = solvedRoutes
  }
}
