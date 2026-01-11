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
  type JPort,
} from "@tscircuit/hypergraph"
import { CurvyTraceSolver } from "@tscircuit/curvy-trace-solver"
import type {
  CurvyTraceProblem,
  Obstacle as CurvyObstacle,
} from "@tscircuit/curvy-trace-solver"

export type Point2D = { x: number; y: number }

export interface JumperPrepatternSolver2HyperParameters {
  /** Number of columns in the jumper grid */
  COLS?: number
  /** Number of rows in the jumper grid */
  ROWS?: number
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

  // Phase tracking for multi-step solving
  phase: "jumperGraph" | "curvyTrace" | "done" = "jumperGraph"

  // Curvy trace solver state (populated after jumperGraph phase completes)
  curvySolvers: Array<{
    solver: CurvyTraceSolver
    regionId: string
    traversals: Array<{
      routeIndex: number
      connectionName: string
      rootConnectionName?: string
    }>
  }> = []
  currentCurvySolverIndex = 0
  routeInfos: Array<{
    connectionId: string
    rootConnectionName?: string
    jumpers: Jumper[]
    traversals: Array<{
      regionId: string
      region: JRegion
      entryPort: JPort
      exitPort: JPort | null
    }>
  }> = []
  // Stores curved paths per region and networkId
  // Each (regionId, networkId) pair can have multiple paths if the route traverses the region multiple times
  regionCurvedPaths: Map<
    string,
    Map<
      string,
      Array<{
        path: Array<{ x: number; y: number }>
        start: { x: number; y: number }
        end: { x: number; y: number }
      }>
    >
  > = new Map()

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
    return {
      cols: this.hyperParameters.COLS ?? 1,
      rows: this.hyperParameters.ROWS ?? 1,
    }
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
      let padMinX = Infinity
      let padMaxX = -Infinity
      let padMinY = Infinity
      let padMaxY = -Infinity
      for (const region of baseGraph.regions) {
        if (!region.d?.isPad) continue
        const bounds = region.d?.bounds
        if (bounds) {
          padMinX = Math.min(padMinX, bounds.minX)
          padMaxX = Math.max(padMaxX, bounds.maxX)
          padMinY = Math.min(padMinY, bounds.minY)
          padMaxY = Math.max(padMaxY, bounds.maxY)
        }
      }

      const paddingAroundPads = 1

      if (
        padMinX - paddingAroundPads < nodeBounds.minX ||
        padMaxX + paddingAroundPads > nodeBounds.maxX ||
        padMinY - paddingAroundPads < nodeBounds.minY ||
        padMaxY + paddingAroundPads > nodeBounds.maxY
      ) {
        this.error = `baseGraph bounds (${padMinX.toFixed(2)}, ${padMinY.toFixed(2)}, ${padMaxX.toFixed(2)}, ${padMaxY.toFixed(2)}) exceed node bounds (${nodeBounds.minX.toFixed(2)}, ${nodeBounds.minY.toFixed(2)}, ${nodeBounds.maxX.toFixed(2)}, ${nodeBounds.maxY.toFixed(2)})`
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
    switch (this.phase) {
      case "jumperGraph":
        this._stepJumperGraph()
        break
      case "curvyTrace":
        this._stepCurvyTrace()
        break
      case "done":
        this.solved = true
        break
    }
  }

  private _stepJumperGraph() {
    // Initialize on first step
    if (!this.jumperGraphSolver) {
      this._initializeGraph()
      if (this.solved) return
      if (!this.jumperGraphSolver) {
        this.failed = true
        return
      }
    }

    // Set activeSubSolver so visualizations show the jumper graph solver
    this.activeSubSolver = this.jumperGraphSolver

    // Step the internal solver
    this.jumperGraphSolver.step()

    if (this.jumperGraphSolver.solved) {
      // Initialize curvy trace solvers for the next phase
      this._initializeCurvyTraceSolvers()
      if (this.curvySolvers.length > 0) {
        this.phase = "curvyTrace"
      } else {
        // No curvy solvers needed, finalize immediately
        this._finalizeCurvyTraceResults()
        this.phase = "done"
        this.solved = true
      }
    } else if (this.jumperGraphSolver.failed) {
      this.error = this.jumperGraphSolver.error
      this.failed = true
    }
  }

  private _stepCurvyTrace() {
    if (this.currentCurvySolverIndex >= this.curvySolvers.length) {
      // All curvy solvers done, finalize
      this._finalizeCurvyTraceResults()
      this.phase = "done"
      this.solved = true
      return
    }

    const currentSolverInfo = this.curvySolvers[this.currentCurvySolverIndex]
    const solver = currentSolverInfo.solver

    // Set activeSubSolver so visualizations show the curvy trace solver
    this.activeSubSolver = solver

    // Step the current curvy solver
    solver.step()

    if (solver.solved) {
      // Store the curved paths from this solver
      const regionId = currentSolverInfo.regionId
      if (!this.regionCurvedPaths.has(regionId)) {
        this.regionCurvedPaths.set(regionId, new Map())
      }

      for (const outputTrace of solver.outputTraces) {
        const networkId = outputTrace.networkId ?? ""
        const points = outputTrace.points.map((p) => ({ x: p.x, y: p.y }))

        // Store path with start/end points for matching during reconstruction
        const pathEntry = {
          path: points,
          start: points[0] ?? { x: 0, y: 0 },
          end: points[points.length - 1] ?? { x: 0, y: 0 },
        }

        // Append to array (don't overwrite) since a route can traverse the same region multiple times
        if (!this.regionCurvedPaths.get(regionId)!.has(networkId)) {
          this.regionCurvedPaths.get(regionId)!.set(networkId, [])
        }
        this.regionCurvedPaths.get(regionId)!.get(networkId)!.push(pathEntry)
      }

      // Move to next solver
      this.currentCurvySolverIndex++
    } else if (solver.failed) {
      // Curvy solver failed, but we can continue with straight lines
      // Just move to the next solver
      this.currentCurvySolverIndex++
    }
  }

  /**
   * Initialize CurvyTraceSolvers for each routing region.
   * Called after JumperGraphSolver completes to set up the curvy trace phase.
   */
  private _initializeCurvyTraceSolvers() {
    if (!this.jumperGraphSolver) return

    // Track which throughjumpers have been used to avoid duplicates
    const usedThroughJumpers = new Set<string>()

    // Build base obstacle info from all jumper pad locations
    // We'll set networkIds later based on which routes use each pad
    type PadObstacleInfo = {
      minX: number
      minY: number
      maxX: number
      maxY: number
      center: { x: number; y: number }
      networkIds: string[] // Routes that connect to this pad
    }
    const padObstacleInfos: PadObstacleInfo[] = []
    for (const jumperLoc of this.jumperLocations) {
      for (const padRegion of jumperLoc.padRegions) {
        const padBounds = padRegion.d.bounds
        const padCenter = padRegion.d.center
        padObstacleInfos.push({
          minX: padBounds.minX,
          minY: padBounds.minY,
          maxX: padBounds.maxX,
          maxY: padBounds.maxY,
          center: { x: padCenter.x, y: padCenter.y },
          networkIds: [],
        })
      }
    }

    // Collect region traversals for all routes, grouped by region
    // Each region may have multiple routes passing through it
    type RegionTraversal = {
      regionId: string
      region: JRegion
      routeIndex: number
      connectionName: string
      rootConnectionName?: string
      entryPort: JPort
      exitPort: JPort
    }
    const regionTraversals: Map<string, RegionTraversal[]> = new Map()

    // First pass: collect region traversals and jumper info for each route
    for (
      let routeIdx = 0;
      routeIdx < this.jumperGraphSolver.solvedRoutes.length;
      routeIdx++
    ) {
      const solvedRoute = this.jumperGraphSolver.solvedRoutes[routeIdx]
      const connectionId = solvedRoute.connection.connectionId
      const rootConnectionName = this.nodeWithPortPoints.portPoints.find(
        (pp) => pp.connectionName === connectionId,
      )?.rootConnectionName
      const jumpers: Jumper[] = []
      const traversals: Array<{
        regionId: string
        region: JRegion
        entryPort: JPort
        exitPort: JPort | null
      }> = []

      // Track current region and entry port
      let currentRegion: JRegion | null = null
      let currentEntryPort: JPort | null = null

      for (let i = 0; i < solvedRoute.path.length; i++) {
        const candidate = solvedRoute.path[i]
        const port = candidate.port as JPort
        const lastRegion = candidate.lastRegion as JRegion | undefined

        // Determine which region we're entering based on the port's connected regions
        // Each port connects two regions (region1 and region2)
        // We enter the region that is NOT the lastRegion
        const r1 = (port as any).region1 as JRegion | undefined
        const r2 = (port as any).region2 as JRegion | undefined
        let nextRegion: JRegion | undefined

        if (lastRegion) {
          // Entering the region that's not the one we came from
          if (r1 && r1.regionId !== lastRegion.regionId) {
            nextRegion = r1
          } else if (r2 && r2.regionId !== lastRegion.regionId) {
            nextRegion = r2
          }
        } else {
          // First port - look ahead to find which region we're entering
          // The next port's lastRegion tells us which region we're actually traversing
          const nextCandidate = solvedRoute.path[i + 1]
          const nextLastRegion = nextCandidate?.lastRegion as
            | JRegion
            | undefined

          if (nextLastRegion) {
            // Pick the region that matches what we'll be coming from at the next port
            if (r1 && r1.regionId === nextLastRegion.regionId) {
              nextRegion = r1
            } else if (r2 && r2.regionId === nextLastRegion.regionId) {
              nextRegion = r2
            }
          }

          // Fallback: prefer non-connection regions over conn:* pseudo-regions
          if (!nextRegion) {
            const isConnRegion = (r: JRegion | undefined) =>
              r?.regionId?.startsWith("conn:")
            if (
              r1 &&
              !isConnRegion(r1) &&
              !r1.d?.isPad &&
              !r1.d?.isThroughJumper
            ) {
              nextRegion = r1
            } else if (
              r2 &&
              !isConnRegion(r2) &&
              !r2.d?.isPad &&
              !r2.d?.isThroughJumper
            ) {
              nextRegion = r2
            } else if (r1 && !r1.d?.isPad && !r1.d?.isThroughJumper) {
              nextRegion = r1
            } else if (r2 && !r2.d?.isPad && !r2.d?.isThroughJumper) {
              nextRegion = r2
            } else {
              nextRegion = r1 || r2
            }
          }
        }

        // Check if we're entering a new region
        if (
          nextRegion &&
          (!currentRegion || nextRegion.regionId !== currentRegion.regionId)
        ) {
          // If we were in a region, record the exit
          if (currentRegion && currentEntryPort) {
            traversals.push({
              regionId: currentRegion.regionId,
              region: currentRegion,
              entryPort: currentEntryPort,
              exitPort: port,
            })

            // Add to global traversals map
            const key = currentRegion.regionId
            if (!regionTraversals.has(key)) {
              regionTraversals.set(key, [])
            }
            regionTraversals.get(key)!.push({
              regionId: currentRegion.regionId,
              region: currentRegion,
              routeIndex: routeIdx,
              connectionName: connectionId,
              rootConnectionName,
              entryPort: currentEntryPort,
              exitPort: port,
            })
          }

          // Start tracking the new region
          currentRegion = nextRegion
          currentEntryPort = port
        }

        // Track jumpers
        if (
          lastRegion?.d?.isThroughJumper &&
          !usedThroughJumpers.has(lastRegion.regionId)
        ) {
          usedThroughJumpers.add(lastRegion.regionId)
          const bounds = lastRegion.d.bounds
          const center = lastRegion.d.center
          const boundsWidth = bounds.maxX - bounds.minX
          const boundsHeight = bounds.maxY - bounds.minY
          const isHorizontal = boundsWidth > boundsHeight

          if (isHorizontal) {
            jumpers.push({
              route_type: "jumper",
              start: { x: bounds.minX, y: center.y },
              end: { x: bounds.maxX, y: center.y },
              footprint: "1206x4_pair",
            })
          } else {
            jumpers.push({
              route_type: "jumper",
              start: { x: center.x, y: bounds.minY },
              end: { x: center.x, y: bounds.maxY },
              footprint: "1206x4_pair",
            })
          }
        }
      }

      // Handle the last region
      if (currentRegion && currentEntryPort) {
        const lastCandidate = solvedRoute.path[solvedRoute.path.length - 1]
        traversals.push({
          regionId: currentRegion.regionId,
          region: currentRegion,
          entryPort: currentEntryPort,
          exitPort: (lastCandidate?.port as JPort) || null,
        })
      }

      this.routeInfos.push({
        connectionId,
        rootConnectionName,
        jumpers,
        traversals,
      })
    }

    // Populate networkIds on pad obstacles based on which routes use which jumper pads
    // A route uses a pad if one of its jumpers has start/end at that pad's center
    const POSITION_TOLERANCE = 0.1
    for (let routeIdx = 0; routeIdx < this.routeInfos.length; routeIdx++) {
      const routeInfo = this.routeInfos[routeIdx]
      const networkId = routeInfo.rootConnectionName ?? routeInfo.connectionId

      for (const jumper of routeInfo.jumpers) {
        // Check both start and end positions of the jumper
        const jumperPositions = [jumper.start, jumper.end]

        for (const pos of jumperPositions) {
          // Find the pad obstacle that matches this position
          for (const padInfo of padObstacleInfos) {
            const dx = Math.abs(padInfo.center.x - pos.x)
            const dy = Math.abs(padInfo.center.y - pos.y)
            if (dx < POSITION_TOLERANCE && dy < POSITION_TOLERANCE) {
              // This pad is used by this route
              if (!padInfo.networkIds.includes(networkId)) {
                padInfo.networkIds.push(networkId)
              }
            }
          }
        }
      }
    }

    // Create CurvyTraceSolvers for each non-pad region
    for (const [regionId, traversals] of regionTraversals) {
      if (traversals.length === 0) continue

      const region = traversals[0].region
      // Skip pad regions and through-jumper regions - these should stay as straight lines
      if (region.d.isPad || region.d.isThroughJumper) continue

      const bounds = region.d.bounds

      // Create waypoint pairs for all routes passing through this region
      const waypointPairs: CurvyTraceProblem["waypointPairs"] = []
      for (const traversal of traversals) {
        waypointPairs.push({
          start: { x: traversal.entryPort.d.x, y: traversal.entryPort.d.y },
          end: { x: traversal.exitPort.d.x, y: traversal.exitPort.d.y },
          networkId: traversal.rootConnectionName ?? traversal.connectionName,
        })
      }

      // Build obstacles for this region with proper networkIds
      // Filter to pads that overlap or are adjacent to this region's bounds
      // Use a small margin to catch pads that touch the region boundary
      const padMargin = 0.01
      const regionObstacles: CurvyObstacle[] = padObstacleInfos
        .filter(
          (padInfo) =>
            padInfo.minX <= bounds.maxX + padMargin &&
            padInfo.maxX >= bounds.minX - padMargin &&
            padInfo.minY <= bounds.maxY + padMargin &&
            padInfo.maxY >= bounds.minY - padMargin,
        )
        .map((padInfo) => {
          // If any of the routes passing through this region connect to this pad,
          // set the networkId so CurvyTraceSolver knows they can connect
          const routeNetworkIds = traversals.map(
            (t) => t.rootConnectionName ?? t.connectionName,
          )
          const matchingNetworkId = padInfo.networkIds.find((nid) =>
            routeNetworkIds.includes(nid),
          )

          return {
            minX: padInfo.minX,
            minY: padInfo.minY,
            maxX: padInfo.maxX,
            maxY: padInfo.maxY,
            center: padInfo.center,
            networkId: matchingNetworkId,
          }
        })

      // Create CurvyTraceSolver for this region (don't solve yet)
      const problem: CurvyTraceProblem = {
        bounds,
        waypointPairs,
        obstacles: regionObstacles,
        preferredTraceToTraceSpacing: this.traceWidth * 2,
        preferredObstacleToTraceSpacing: this.traceWidth * 2,
      }

      const curvySolver = new CurvyTraceSolver(problem)

      this.curvySolvers.push({
        solver: curvySolver,
        regionId,
        traversals: traversals.map((t) => ({
          routeIndex: t.routeIndex,
          connectionName: t.connectionName,
          rootConnectionName: t.rootConnectionName,
        })),
      })
    }
  }

  /**
   * Finalize results after all CurvyTraceSolvers have completed.
   * Assembles final routes using curved paths where available.
   */
  private _finalizeCurvyTraceResults() {
    // Helper to find distance between two points
    const dist = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
      Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)

    // Build final routes using curved paths where available
    for (let routeIdx = 0; routeIdx < this.routeInfos.length; routeIdx++) {
      const routeInfo = this.routeInfos[routeIdx]
      const routePoints: Array<{ x: number; y: number; z: number }> = []

      for (const traversal of routeInfo.traversals) {
        const regionId = traversal.regionId
        const networkId = routeInfo.rootConnectionName ?? routeInfo.connectionId

        // Check if we have curved paths for this region and networkId
        const curvedPaths = this.regionCurvedPaths.get(regionId)?.get(networkId)

        // Find the curved path that matches this traversal's entry/exit points
        let matchedPath: Array<{ x: number; y: number }> | null = null
        if (curvedPaths && curvedPaths.length > 0) {
          const entryPoint = {
            x: traversal.entryPort.d.x,
            y: traversal.entryPort.d.y,
          }
          const exitPoint = traversal.exitPort
            ? { x: traversal.exitPort.d.x, y: traversal.exitPort.d.y }
            : null

          // Find the path that best matches entry/exit points
          let bestMatch: (typeof curvedPaths)[0] | null = null
          let bestScore = Infinity

          for (const pathEntry of curvedPaths) {
            // Calculate how well this path matches the traversal
            const startDist = dist(pathEntry.start, entryPoint)
            const endDist = exitPoint ? dist(pathEntry.end, exitPoint) : 0
            const score = startDist + endDist

            if (score < bestScore) {
              bestScore = score
              bestMatch = pathEntry
            }
          }

          // Use a tolerance for matching (points should be very close)
          if (bestMatch && bestScore < 0.5) {
            matchedPath = bestMatch.path
          }
        }

        if (matchedPath && matchedPath.length > 0) {
          // Use the curved path
          // Skip the first point if we already have points (to avoid duplicates)
          const startIdx = routePoints.length > 0 ? 1 : 0
          for (let i = startIdx; i < matchedPath.length; i++) {
            routePoints.push({ x: matchedPath[i].x, y: matchedPath[i].y, z: 0 })
          }
        } else {
          // Use straight line for pad regions, through-jumper regions, or fallback
          // Skip the first point if we already have points
          if (routePoints.length === 0) {
            routePoints.push({
              x: traversal.entryPort.d.x,
              y: traversal.entryPort.d.y,
              z: 0,
            })
          }
          if (traversal.exitPort) {
            routePoints.push({
              x: traversal.exitPort.d.x,
              y: traversal.exitPort.d.y,
              z: 0,
            })
          }
        }
      }

      this.solvedRoutes.push({
        connectionName: routeInfo.connectionId,
        rootConnectionName: routeInfo.rootConnectionName,
        traceThickness: this.traceWidth,
        route: routePoints,
        jumpers: routeInfo.jumpers,
      })
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
