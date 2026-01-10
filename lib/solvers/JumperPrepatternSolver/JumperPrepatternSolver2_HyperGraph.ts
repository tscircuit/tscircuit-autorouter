import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type {
  HighDensityIntraNodeRouteWithJumpers,
  Jumper,
  NodeWithPortPoints,
  PortPoint,
} from "../../types/high-density-types"
import type { Jumper as SrjJumper, Obstacle } from "../../types/srj-types"
import { safeTransparentize } from "../colors"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  type JumperFootprint,
  JUMPER_DIMENSIONS,
} from "../../utils/jumperSizes"
import {
  JumperGraphSolver,
  generateJumperX4Grid,
  createGraphWithConnectionsFromBaseGraph,
  type JRegion,
} from "@tscircuit/hypergraph"
import { areSegmentsCollinear } from "./areSegmentsCollinear"
import { getCollinearOverlapInfo } from "./getCollinearOverlapInfo"
import { computeOffsetMidpoint } from "./computeOffsetMidpoint"
import { createRegionOffsetPoints } from "./createRegionOffsetPoints"
import { doBoundsOverlap, doSegmentsIntersect } from "@tscircuit/math-utils"

export type Point2D = { x: number; y: number }

export type HyperGraphPatternType =
  | "single_1206x4"
  | "1x2_1206x4"
  | "2x2_1206x4"
  | "3x1_1206x4"
  | "3x2_1206x4"
  | "3x3_1206x4"
  | "4x4_1206x4"
  | "6x4_1206x4"
  | "8x4_1206x4"

export interface JumperPrepatternSolver2HyperParameters {
  /** Pattern type for jumper placement - "single_1206x4" (~8x8mm) or "2x2_1206x4" (~14x14mm) */
  PATTERN_TYPE?: HyperGraphPatternType
  /** Orientation of jumpers - "horizontal" or "vertical" */
  ORIENTATION?: "horizontal" | "vertical"
}

export interface JumperPrepatternSolver2Params {
  nodeWithPortPoints: NodeWithPortPoints
  colorMap?: Record<string, string>
  traceWidth?: number
  hyperParameters?: JumperPrepatternSolver2HyperParameters
  connMap?: ConnectivityMap
}

interface XYConnection {
  start: { x: number; y: number }
  end: { x: number; y: number }
  connectionId: string
}

export class JumperPrepatternSolver2_HyperGraph extends BaseSolver {
  // Input parameters
  constructorParams: JumperPrepatternSolver2Params
  nodeWithPortPoints: NodeWithPortPoints
  colorMap: Record<string, string>
  traceWidth: number
  hyperParameters: JumperPrepatternSolver2HyperParameters

  // Internal solver
  jumperGraphSolver: JumperGraphSolver | null = null
  xyConnections: XYConnection[] = []

  // Graph bounds for visualization
  graphBounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null = null

  // All jumper positions from the baseGraph (includes padRegions for obstacle generation)
  jumperLocations: Array<{
    center: { x: number; y: number }
    orientation: "vertical" | "horizontal"
    padRegions: JRegion[]
  }> = []

  // Output
  solvedRoutes: HighDensityIntraNodeRouteWithJumpers[] = []

  // SRJ Jumpers with obstacles (populated after solving)
  jumpers: SrjJumper[] = []

  constructor(params: JumperPrepatternSolver2Params) {
    super()
    this.constructorParams = params
    this.nodeWithPortPoints = params.nodeWithPortPoints
    this.colorMap = params.colorMap ?? {}
    this.traceWidth = params.traceWidth ?? 0.15
    this.hyperParameters = params.hyperParameters ?? {}
    this.MAX_ITERATIONS = 1e6

    // Initialize colorMap if not provided
    if (Object.keys(this.colorMap).length === 0) {
      this.colorMap = this._buildColorMap()
    }
  }

  getConstructorParams(): JumperPrepatternSolver2Params {
    return this.constructorParams
  }

  private _buildColorMap(): Record<string, string> {
    const colors = [
      "#e6194b",
      "#3cb44b",
      "#ffe119",
      "#4363d8",
      "#f58231",
      "#911eb4",
      "#46f0f0",
      "#f032e6",
      "#bcf60c",
      "#fabebe",
    ]
    const colorMap: Record<string, string> = {}
    const connectionNames = new Set<string>()
    for (const pp of this.nodeWithPortPoints.portPoints) {
      connectionNames.add(pp.connectionName)
    }
    let i = 0
    for (const name of Array.from(connectionNames)) {
      colorMap[name] = colors[i % colors.length]
      i++
    }
    return colorMap
  }

  private _getPatternConfig(): { cols: number; rows: number } {
    const patternType = this.hyperParameters.PATTERN_TYPE ?? "single_1206x4"
    if (patternType === "8x4_1206x4") {
      return { cols: 8, rows: 4 }
    }
    if (patternType === "6x4_1206x4") {
      return { cols: 6, rows: 4 }
    }
    if (patternType === "4x4_1206x4") {
      return { cols: 4, rows: 4 }
    }
    if (patternType === "3x3_1206x4") {
      return { cols: 3, rows: 3 }
    }
    if (patternType === "3x2_1206x4") {
      return { cols: 3, rows: 2 }
    }
    if (patternType === "3x1_1206x4") {
      return { cols: 3, rows: 1 }
    }
    if (patternType === "2x2_1206x4") {
      return { cols: 2, rows: 2 }
    }
    if (patternType === "1x2_1206x4") {
      return { cols: 1, rows: 2 }
    }
    return { cols: 1, rows: 1 }
  }

  private _initializeGraph(): boolean {
    const node = this.nodeWithPortPoints
    const patternConfig = this._getPatternConfig()
    const orientation = this.hyperParameters.ORIENTATION ?? "vertical"

    // Calculate node bounds
    const nodeBounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    this.graphBounds = nodeBounds

    // Generate the base jumper grid to fit the node bounds exactly
    const baseGraph = generateJumperX4Grid({
      cols: patternConfig.cols,
      rows: patternConfig.rows,
      marginX: Math.max(1.2, patternConfig.cols * 0.3),
      marginY: Math.max(1.2, patternConfig.rows * 0.3),
      outerPaddingX: 0.4,
      outerPaddingY: 0.4,
      parallelTracesUnderJumperCount: 3,
      innerColChannelPointCount: 3, // Math.min(3, 1 + patternConfig.cols),
      innerRowChannelPointCount: 3, // Math.min(3, 1 + patternConfig.rows),
      outerChannelXPointCount: 3, // Math.max(5, patternConfig.cols * 3),
      outerChannelYPointCount: 3, // Math.max(5, patternConfig.rows * 3),
      regionsBetweenPads: true,
      orientation,
      bounds: nodeBounds,
    })

    // Check if baseGraph bounds exceed node bounds - fail immediately if so
    // Compute bounds from regions since JumperGraph doesn't have a bounds property
    if (baseGraph.regions.length > 0) {
      // TODO import calculateGraphBounds from @tscircuit/hypergraph (when
      // exported)
      let bgMinX = Infinity
      let bgMaxX = -Infinity
      let bgMinY = Infinity
      let bgMaxY = -Infinity
      for (const region of baseGraph.regions) {
        const bounds = region.d?.bounds
        if (bounds) {
          bgMinX = Math.min(bgMinX, bounds.minX)
          bgMaxX = Math.max(bgMaxX, bounds.maxX)
          bgMinY = Math.min(bgMinY, bounds.minY)
          bgMaxY = Math.max(bgMaxY, bounds.maxY)
        }
      }

      const margin = 0.4

      if (
        bgMinX < nodeBounds.minX - margin ||
        bgMaxX > nodeBounds.maxX + margin ||
        bgMinY < nodeBounds.minY - margin ||
        bgMaxY > nodeBounds.maxY + margin
      ) {
        this.error = `baseGraph bounds (${bgMinX.toFixed(2)}, ${bgMinY.toFixed(2)}, ${bgMaxX.toFixed(2)}, ${bgMaxY.toFixed(2)}) exceed node bounds (${nodeBounds.minX.toFixed(2)}, ${nodeBounds.minY.toFixed(2)}, ${nodeBounds.maxX.toFixed(2)}, ${nodeBounds.maxY.toFixed(2)})`
        this.failed = true
        return false
      }
    }

    // Store all jumper positions from the baseGraph (including padRegions for obstacle generation)
    this.jumperLocations =
      baseGraph.jumperLocations?.map((loc) => ({
        center: loc.center,
        orientation: loc.orientation,
        padRegions: loc.padRegions,
      })) ?? []

    // Build connections from port points
    // Group port points by connection name
    const connectionMap = new Map<
      string,
      { points: PortPoint[]; rootConnectionName?: string }
    >()
    for (const pp of node.portPoints) {
      const existing = connectionMap.get(pp.connectionName)
      if (existing) {
        existing.points.push(pp)
      } else {
        connectionMap.set(pp.connectionName, {
          points: [pp],
          rootConnectionName: pp.rootConnectionName,
        })
      }
    }

    // Create XY connections - use port point positions directly since graph matches node bounds
    this.xyConnections = []
    for (const [connectionName, data] of Array.from(connectionMap.entries())) {
      if (data.points.length < 2) continue

      this.xyConnections.push({
        start: { x: data.points[0].x, y: data.points[0].y },
        end: { x: data.points[1].x, y: data.points[1].y },
        connectionId: connectionName,
      })
    }

    if (this.xyConnections.length === 0) {
      this.solved = true
      return true
    }

    // Create graph with connections
    const graphWithConnections = createGraphWithConnectionsFromBaseGraph(
      baseGraph,
      this.xyConnections,
    )

    // Create the JumperGraphSolver
    this.jumperGraphSolver = new JumperGraphSolver({
      inputGraph: {
        regions: graphWithConnections.regions,
        ports: graphWithConnections.ports,
      },
      inputConnections: graphWithConnections.connections,
    })
    // TODO multiply by effort
    this.jumperGraphSolver.MAX_ITERATIONS *= 3

    return true
  }

  _step() {
    // Initialize on first step
    if (!this.jumperGraphSolver) {
      this._initializeGraph()
      if (this.solved) return
      if (!this.jumperGraphSolver) {
        this.error = "Failed to initialize hypergraph solver"
        this.failed = true
        return
      }
    }

    // Step the internal solver
    this.jumperGraphSolver.step()

    if (this.jumperGraphSolver.solved) {
      this._processResults()
      this._addMidpointsForCollinearOverlaps()
      this.solved = true
    } else if (this.jumperGraphSolver.failed) {
      this.error = this.jumperGraphSolver.error
      this.failed = true
    }
  }

  private _processResults() {
    if (!this.jumperGraphSolver) return

    // Offset distance to push points slightly inside regions (mm)
    // This helps subsequent force-directed solvers understand segment lies within region
    const OFFSET_POINT_INSIDE_REGION = 0.02

    // Track which throughjumpers have been used to avoid duplicates
    const usedThroughJumpers = new Set<string>()

    // Convert solved routes from HyperGraph format to HighDensityIntraNodeRouteWithJumpers
    for (const solvedRoute of this.jumperGraphSolver.solvedRoutes) {
      const connectionId = solvedRoute.connection.connectionId

      // Extract route points from the solved path
      const routePoints: Array<{
        x: number
        y: number
        z: number
        insideJumperPad?: boolean
      }> = []
      const jumpers: Jumper[] = []

      for (const candidate of solvedRoute.path) {
        const port = candidate.port
        const r1 = port.region1 as any
        const r2 = port.region2 as any
        const lastRegion = candidate.lastRegion as any

        // Create two offset points entering each adjacent region
        const offsetPoints = createRegionOffsetPoints({
          baseX: port.d.x,
          baseY: port.d.y,
          r1Center: r1?.d?.center,
          r2Center: r2?.d?.center,
          cameFromRegion1: lastRegion?.regionId === r1?.regionId,
          insideJumperPad: Boolean(r1?.d.isPad || r2?.d.isPad),
          offsetDistance: OFFSET_POINT_INSIDE_REGION,
        })
        routePoints.push(...offsetPoints)

        // Check if we crossed through a jumper (lastRegion is a throughjumper)
        const region = candidate.lastRegion as any
        if (
          region?.d?.isThroughJumper &&
          !usedThroughJumpers.has(region.regionId)
        ) {
          usedThroughJumpers.add(region.regionId)

          // Use the throughjumper region's bounds to get the correct pad positions
          // Determine orientation from bounds - if width > height, it's horizontal
          const bounds = region.d.bounds
          const center = region.d.center
          const boundsWidth = bounds.maxX - bounds.minX
          const boundsHeight = bounds.maxY - bounds.minY
          const isHorizontal = boundsWidth > boundsHeight

          if (isHorizontal) {
            // Horizontal jumper: pads are on left (minX) and right (maxX), same Y
            jumpers.push({
              route_type: "jumper",
              start: { x: bounds.minX, y: center.y },
              end: { x: bounds.maxX, y: center.y },
              footprint: "1206x4_pair",
            })
          } else {
            // Vertical jumper: pads are on bottom (minY) and top (maxY), same X
            jumpers.push({
              route_type: "jumper",
              start: { x: center.x, y: bounds.minY },
              end: { x: center.x, y: bounds.maxY },
              footprint: "1206x4_pair",
            })
          }
        }
      }

      // Find the root connection name from our input
      const rootConnectionName = this.nodeWithPortPoints.portPoints.find(
        (pp) => pp.connectionName === connectionId,
      )?.rootConnectionName

      this.solvedRoutes.push({
        connectionName: connectionId,
        rootConnectionName,
        traceThickness: this.traceWidth,
        route: routePoints,
        jumpers,
      })
    }
  }

  /**
   * Post-process routes to add offset midpoints for collinear overlapping segments.
   *
   * When two segments are collinear and overlap (arranged as A-C-D-B where AB
   * is one segment and CD is another), the outer segment (AB) needs a midpoint
   * pushed to the side to hint to the force-directed graph that it should route
   * around the inner segment.
   *
   * This handles both:
   * 1. Segments from different connections that overlap
   * 2. Segments from the SAME connection that overlap (when a route doubles back)
   */
  private _addMidpointsForCollinearOverlaps() {
    // Offset distance for the midpoint (mm) - should be enough to hint direction
    const OFFSET_DISTANCE = 0.5

    // Collect all segments from all routes
    type RouteSegment = {
      routeIndex: number
      segmentIndex: number
      start: Point2D
      end: Point2D
      connectionName: string
      isInsideJumperPad: boolean
    }

    const allSegments: RouteSegment[] = []

    for (let routeIdx = 0; routeIdx < this.solvedRoutes.length; routeIdx++) {
      const route = this.solvedRoutes[routeIdx]
      for (let i = 0; i < route.route.length - 1; i++) {
        const p1 = route.route[i] as {
          x: number
          y: number
          z: number
          insideJumperPad?: boolean
        }
        const p2 = route.route[i + 1] as {
          x: number
          y: number
          z: number
          insideJumperPad?: boolean
        }

        // Track whether this segment is inside jumper pads
        const isInsideJumperPad = Boolean(
          p1.insideJumperPad && p2.insideJumperPad,
        )

        allSegments.push({
          routeIndex: routeIdx,
          segmentIndex: i,
          start: { x: p1.x, y: p1.y },
          end: { x: p2.x, y: p2.y },
          connectionName: route.connectionName,
          isInsideJumperPad,
        })
      }
    }

    // Track which routes need midpoint insertions (routeIndex -> list of insertions)
    // Use a Set to track unique insertions by segment index to avoid duplicates
    const insertions: Map<
      number,
      Map<number, { afterSegmentIndex: number; point: Point2D & { z: number } }>
    > = new Map()

    // Compare all pairs of segments (including from the same route!)
    for (let i = 0; i < allSegments.length; i++) {
      for (let j = i + 1; j < allSegments.length; j++) {
        const seg1 = allSegments[i]
        const seg2 = allSegments[j]

        // For same-route segments, skip adjacent segments (they share an endpoint)
        if (
          seg1.routeIndex === seg2.routeIndex &&
          Math.abs(seg1.segmentIndex - seg2.segmentIndex) <= 1
        ) {
          continue
        }

        // Check if segments are collinear
        if (!areSegmentsCollinear(seg1.start, seg1.end, seg2.start, seg2.end)) {
          continue
        }

        // Check if they overlap and get info about which is outer
        const overlapInfo = getCollinearOverlapInfo(
          seg1.start,
          seg1.end,
          seg2.start,
          seg2.end,
        )

        if (!overlapInfo) continue

        // Determine which route/segment is the outer one
        const outerSeg = overlapInfo.outerSegment === 1 ? seg1 : seg2

        // Compute offset midpoint for the outer segment
        const offsetMidpoint = computeOffsetMidpoint(
          overlapInfo.outerStart,
          overlapInfo.outerEnd,
          OFFSET_DISTANCE,
        )

        // Skip adding midpoints if the segment is inside jumper pads
        if (outerSeg.isInsideJumperPad) {
          continue
        }

        // Check if adding this midpoint would cause new intersections with other routes
        // The new segments would be: (outerStart -> offsetMidpoint) and (offsetMidpoint -> outerEnd)
        let wouldCauseIntersection = false
        for (const otherSeg of allSegments) {
          // Skip the outer segment itself and adjacent segments in the same route
          if (
            otherSeg.routeIndex === outerSeg.routeIndex &&
            Math.abs(otherSeg.segmentIndex - outerSeg.segmentIndex) <= 1
          ) {
            continue
          }

          // Check if the new segment from start to midpoint intersects with other segment
          if (
            doSegmentsIntersect(
              overlapInfo.outerStart,
              offsetMidpoint,
              otherSeg.start,
              otherSeg.end,
            )
          ) {
            wouldCauseIntersection = true
            break
          }

          // Check if the new segment from midpoint to end intersects with other segment
          if (
            doSegmentsIntersect(
              offsetMidpoint,
              overlapInfo.outerEnd,
              otherSeg.start,
              otherSeg.end,
            )
          ) {
            wouldCauseIntersection = true
            break
          }
        }

        // Skip adding this midpoint if it would cause new intersections
        if (wouldCauseIntersection) {
          continue
        }

        // Add to insertions for the outer route (using Map to dedupe by segment index)
        if (!insertions.has(outerSeg.routeIndex)) {
          insertions.set(outerSeg.routeIndex, new Map())
        }
        const routeInsertions = insertions.get(outerSeg.routeIndex)!
        // Only add if we haven't already added an insertion for this segment
        if (!routeInsertions.has(outerSeg.segmentIndex)) {
          routeInsertions.set(outerSeg.segmentIndex, {
            afterSegmentIndex: outerSeg.segmentIndex,
            point: { ...offsetMidpoint, z: 0 },
          })
        }
      }
    }

    // Apply insertions to routes (in reverse order to preserve indices)
    for (const [routeIndex, routeInsertionsMap] of insertions) {
      // Convert map to array and sort by segment index descending
      const routeInsertions = Array.from(routeInsertionsMap.values())
      routeInsertions.sort((a, b) => b.afterSegmentIndex - a.afterSegmentIndex)

      const route = this.solvedRoutes[routeIndex]
      for (const insertion of routeInsertions) {
        // Insert the midpoint after the start of the segment (at index + 1)
        route.route.splice(insertion.afterSegmentIndex + 1, 0, insertion.point)
      }
    }
  }

  getOutput(): HighDensityIntraNodeRouteWithJumpers[] {
    return this.solvedRoutes
  }

  /**
   * Returns all jumpers from the baseGraph as SRJ Jumper objects.
   * The pads have connectedTo set based on which routes use each jumper.
   * Must be called after the solver is solved.
   */
  getOutputJumpers(): SrjJumper[] {
    if (this.jumpers.length > 0) {
      return this.jumpers
    }

    // Build a map of pad center -> connection names that use it
    // by examining the solved routes' jumpers.
    // Route jumpers have start/end at individual pad positions, so we use those
    // directly as keys rather than the jumperLocation center.
    const padUsageMap = new Map<string, string[]>()
    const TOLERANCE = 0.01

    for (const route of this.solvedRoutes) {
      for (const jumper of route.jumpers) {
        // Both start and end of a route jumper are pad positions
        const positions = [jumper.start, jumper.end]

        for (const pos of positions) {
          const key = `${pos.x.toFixed(3)},${pos.y.toFixed(3)}`
          const connectedTo = padUsageMap.get(key) ?? []
          if (
            route.rootConnectionName &&
            !connectedTo.includes(route.rootConnectionName)
          ) {
            connectedTo.push(route.rootConnectionName)
          }
          if (!connectedTo.includes(route.connectionName)) {
            connectedTo.push(route.connectionName)
          }
          padUsageMap.set(key, connectedTo)
        }
      }
    }

    // Convert all jumperLocations to SRJ Jumpers
    const dims = JUMPER_DIMENSIONS["1206x4_pair"]

    for (const jumperLoc of this.jumperLocations) {
      const isHorizontal = jumperLoc.orientation === "horizontal"

      // Get pad obstacles from padRegions, matching each pad to its connectedTo
      const pads: Obstacle[] = jumperLoc.padRegions.map((padRegion) => {
        const bounds = padRegion.d.bounds
        const padCenter = padRegion.d.center
        const padWidth = bounds.maxX - bounds.minX
        const padHeight = bounds.maxY - bounds.minY

        // Look up connections for this specific pad position
        const padKey = `${padCenter.x.toFixed(3)},${padCenter.y.toFixed(3)}`
        const connectedTo = padUsageMap.get(padKey) ?? []

        return {
          type: "rect" as const,
          center: padCenter,
          width: padWidth,
          height: padHeight,
          layers: ["top"],
          connectedTo: [...connectedTo],
        }
      })

      const srjJumper: SrjJumper = {
        jumper_footprint: "1206x4",
        center: jumperLoc.center,
        orientation: jumperLoc.orientation,
        width: isHorizontal ? dims.length : dims.width,
        height: isHorizontal ? dims.width : dims.length,
        pads,
      }

      this.jumpers.push(srjJumper)
    }

    // Filter out unused jumpers (those where no pads have any connections)
    this.jumpers = this.jumpers.filter((jumper) =>
      jumper.pads.some((pad) => pad.connectedTo.length > 0),
    )

    return this.jumpers
  }

  visualize(): GraphicsObject {
    if (this.jumperGraphSolver && !this.solved) {
      return this.jumperGraphSolver.visualize()
    }

    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    const node = this.nodeWithPortPoints
    const bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }

    // Draw node boundary
    graphics.lines!.push({
      points: [
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.minY },
      ],
      strokeColor: "rgba(255, 0, 0, 0.25)",
      strokeDash: "4 4",
      layer: "border",
    })

    // Draw port points
    for (const pp of node.portPoints) {
      graphics.points!.push({
        x: pp.x,
        y: pp.y,
        label: pp.connectionName,
        color: this.colorMap[pp.connectionName] ?? "blue",
      })
    }

    // Draw solved routes
    for (const route of this.solvedRoutes) {
      const color = this.colorMap[route.connectionName] ?? "blue"

      for (let i = 0; i < route.route.length - 1; i++) {
        const p1 = route.route[i]
        const p2 = route.route[i + 1]

        graphics.lines!.push({
          points: [p1, p2],
          strokeColor: safeTransparentize(color, 0.2),
          strokeWidth: route.traceThickness,
          layer: "route-layer-0",
        })
      }

      // Draw jumpers
      for (const jumper of route.jumpers) {
        this._drawJumperPads(graphics, jumper, safeTransparentize(color, 0.5))
      }
    }

    return graphics
  }

  private _drawJumperPads(
    graphics: GraphicsObject,
    jumper: Jumper,
    color: string,
  ) {
    const dims = JUMPER_DIMENSIONS[jumper.footprint]
    const dx = jumper.end.x - jumper.start.x
    const dy = jumper.end.y - jumper.start.y

    const isHorizontal = Math.abs(dx) > Math.abs(dy)
    const rectWidth = isHorizontal ? dims.padLength : dims.padWidth
    const rectHeight = isHorizontal ? dims.padWidth : dims.padLength

    graphics.rects!.push({
      center: { x: jumper.start.x, y: jumper.start.y },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    graphics.rects!.push({
      center: { x: jumper.end.x, y: jumper.end.y },
      width: rectWidth,
      height: rectHeight,
      fill: color,
      stroke: "rgba(0, 0, 0, 0.5)",
      layer: "jumper",
    })

    graphics.lines!.push({
      points: [jumper.start, jumper.end],
      strokeColor: "rgba(100, 100, 100, 0.8)",
      strokeWidth: dims.padWidth * 0.3,
      layer: "jumper-body",
    })
  }
}
