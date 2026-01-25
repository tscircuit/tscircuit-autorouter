import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { BaseSolver } from "../BaseSolver"
import {
  HighDensityRoute,
  HighDensityRouteSpatialIndex,
} from "lib/data-structures/HighDensityRouteSpatialIndex"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { GraphicsObject } from "graphics-debug"

interface RouteSection {
  startIndex: number
  endIndex: number
  z: number
  points: HighDensityRoute["route"]
}

export class SingleRouteUselessViaRemovalSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleRouteUselessViaRemovalSolver"
  }

  obstacleSHI: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex
  unsimplifiedRoute: HighDensityRoute

  routeSections: Array<RouteSection>

  currentSectionIndex: number

  TRACE_THICKNESS = 0.15
  OBSTACLE_MARGIN = 0.1

  constructor(params: {
    obstacleSHI: ObstacleSpatialHashIndex
    hdRouteSHI: HighDensityRouteSpatialIndex
    unsimplifiedRoute: HighDensityRoute
  }) {
    super()
    this.currentSectionIndex = 0 // Start at 0 to check first section for MLCP via removal
    this.obstacleSHI = params.obstacleSHI
    this.hdRouteSHI = params.hdRouteSHI
    this.unsimplifiedRoute = params.unsimplifiedRoute

    this.routeSections = this.breakRouteIntoSections(this.unsimplifiedRoute)
  }

  breakRouteIntoSections(route: HighDensityRoute) {
    const routeSections: this["routeSections"] = []
    const routePoints = route.route
    if (routePoints.length === 0) return []

    let currentSection = {
      startIndex: 0,
      endIndex: -1,
      z: routePoints[0].z,
      points: [routePoints[0]],
    }
    for (let i = 1; i < routePoints.length; i++) {
      if (routePoints[i].z === currentSection.z) {
        currentSection.points.push(routePoints[i])
      } else {
        currentSection.endIndex = i - 1
        routeSections.push(currentSection)
        currentSection = {
          startIndex: i,
          endIndex: -1,
          z: routePoints[i].z,
          points: [routePoints[i]],
        }
      }
    }
    currentSection.endIndex = routePoints.length - 1
    routeSections.push(currentSection)

    return routeSections
  }

  _step() {
    if (this.currentSectionIndex >= this.routeSections.length) {
      this.solved = true
      return
    }

    // Handle first section (endpoint 1) - can be moved if it's a multi-layer connection point
    if (this.currentSectionIndex === 0 && this.routeSections.length > 1) {
      const firstSection = this.routeSections[0]
      const secondSection = this.routeSections[1]

      if (firstSection.z !== secondSection.z) {
        // Try moving first section to match second section (for MLCP endpoints)
        const targetZ = secondSection.z
        // Check that the endpoint obstacle supports the target layer
        const firstPoint = firstSection.points[0]
        const endpointSupportsLayer = this.canEndpointConnectOnLayer(
          firstPoint.x,
          firstPoint.y,
          targetZ,
        )
        if (
          endpointSupportsLayer &&
          this.canSectionMoveToLayer({ currentSection: firstSection, targetZ })
        ) {
          firstSection.z = targetZ
          firstSection.points = firstSection.points.map((p) => ({
            ...p,
            z: targetZ,
          }))
          this.currentSectionIndex = 2 // Skip to after the now-merged sections
          return
        }
      }
      this.currentSectionIndex++
      return
    }

    // Handle last section (endpoint 2) - can be moved if it's a multi-layer connection point
    if (this.currentSectionIndex === this.routeSections.length - 1) {
      // Only attempt via removal if there are at least 2 sections
      if (this.routeSections.length >= 2) {
        const lastSection = this.routeSections[this.routeSections.length - 1]
        const secondLastSection =
          this.routeSections[this.routeSections.length - 2]

        if (lastSection.z !== secondLastSection.z) {
          // Try moving last section to match second-last section (for MLCP endpoints)
          const targetZ = secondLastSection.z
          // Check that the endpoint obstacle supports the target layer
          const lastPoint = lastSection.points[lastSection.points.length - 1]
          const endpointSupportsLayer = this.canEndpointConnectOnLayer(
            lastPoint.x,
            lastPoint.y,
            targetZ,
          )
          if (
            endpointSupportsLayer &&
            this.canSectionMoveToLayer({ currentSection: lastSection, targetZ })
          ) {
            lastSection.z = targetZ
            lastSection.points = lastSection.points.map((p) => ({
              ...p,
              z: targetZ,
            }))
          }
        }
      }
      this.solved = true
      return
    }

    // Handle middle sections (original logic)
    const prevSection = this.routeSections[this.currentSectionIndex - 1]
    const currentSection = this.routeSections[this.currentSectionIndex]
    const nextSection = this.routeSections[this.currentSectionIndex + 1]

    if (prevSection.z !== nextSection.z) {
      // We only remove vias where there is a middle section that can be
      // replaced by the layer of adjacent sections, if the adjacent sections
      // don't have matching layers, a more complex algo is needed
      this.currentSectionIndex++
      return
    }

    const targetZ = prevSection.z

    if (this.canSectionMoveToLayer({ currentSection, targetZ })) {
      currentSection.z = targetZ
      currentSection.points = currentSection.points.map((p) => ({
        ...p,
        z: targetZ,
      }))
      this.currentSectionIndex += 2
      return
    }

    this.currentSectionIndex++
    return
  }

  /**
   * Check if an endpoint (first or last point of the route) can connect
   * to a different layer. This is only allowed if the obstacles the endpoint
   * connects to support that layer.
   */
  canEndpointConnectOnLayer(
    endpointX: number,
    endpointY: number,
    targetZ: number,
  ): boolean {
    // Find obstacles near the endpoint that are connected to this route
    // Use a larger search area to find obstacles the endpoint might be inside
    const nearbyObstacles = this.obstacleSHI.searchArea(
      endpointX,
      endpointY,
      2, // Search wider area
      2,
    )

    // Filter to obstacles that this trace connects to and contain the endpoint
    const connectedObstacles = nearbyObstacles.filter((obstacle) => {
      if (
        !obstacle.connectedTo?.includes(this.unsimplifiedRoute.connectionName)
      ) {
        return false
      }
      // Check if the endpoint is within or very close to the obstacle bounds
      const halfWidth = obstacle.width / 2 + 0.05 // Add small margin
      const halfHeight = obstacle.height / 2 + 0.05
      const withinX = Math.abs(endpointX - obstacle.center.x) <= halfWidth
      const withinY = Math.abs(endpointY - obstacle.center.y) <= halfHeight
      return withinX && withinY
    })

    // If we found connected obstacles, check if any support the target layer
    if (connectedObstacles.length > 0) {
      return connectedObstacles.some((obstacle) =>
        obstacle.zLayers?.includes(targetZ),
      )
    }

    // If no connected obstacles found at the endpoint, the endpoint
    // might be a via or intermediate point - allow the layer change
    return true
  }

  canSectionMoveToLayer({
    currentSection,
    targetZ,
  }: {
    currentSection: RouteSection
    targetZ: number
  }): boolean {
    // Evaluate if the section layer can be changed without hitting anything
    for (let i = 0; i < currentSection.points.length - 1; i++) {
      const A = { ...currentSection.points[i], z: targetZ }
      const B = { ...currentSection.points[i + 1], z: targetZ }

      const conflictingRoutes = this.hdRouteSHI.getConflictingRoutesForSegment(
        A,
        B,
        this.TRACE_THICKNESS,
      )

      for (const { conflictingRoute, distance } of conflictingRoutes) {
        if (
          conflictingRoute.connectionName ===
          this.unsimplifiedRoute.connectionName
        )
          continue
        // TODO connMap test
        if (distance < this.TRACE_THICKNESS + conflictingRoute.traceThickness) {
          return false
        }
      }

      const segmentBox = {
        centerX: (A.x + B.x) / 2,
        centerY: (A.y + B.y) / 2,
        width: Math.abs(A.x - B.x),
        height: Math.abs(A.y - B.y),
      }

      // Obstacle check
      const obstacles = this.obstacleSHI.searchArea(
        segmentBox.centerX,
        segmentBox.centerY,
        segmentBox.width + (this.TRACE_THICKNESS + this.OBSTACLE_MARGIN) * 2, // Expand search width
        segmentBox.height + (this.TRACE_THICKNESS + this.OBSTACLE_MARGIN) * 2, // Expand search height
      )

      for (const obstacle of obstacles) {
        // Skip obstacles that are connected to this trace
        // (the trace is supposed to connect to them)
        if (
          obstacle.connectedTo?.includes(this.unsimplifiedRoute.connectionName)
        ) {
          continue
        }

        // For obstacles that support the target layer, only skip if the trace
        // is connecting TO the obstacle (at segment endpoints)
        if (obstacle.zLayers?.includes(targetZ)) {
          // Check if either endpoint of this segment is at the obstacle center
          const isAtObstacle =
            (Math.abs(A.x - obstacle.center.x) < 0.01 &&
              Math.abs(A.y - obstacle.center.y) < 0.01) ||
            (Math.abs(B.x - obstacle.center.x) < 0.01 &&
              Math.abs(B.y - obstacle.center.y) < 0.01)
          if (isAtObstacle) {
            continue
          }
        }

        const distToObstacle = segmentToBoxMinDistance(A, B, obstacle)

        if (distToObstacle < this.TRACE_THICKNESS + this.OBSTACLE_MARGIN) {
          return false
        }
      }
    }

    return true
  }

  getConstructorParams() {
    return {
      obstacleSHI: this.obstacleSHI,
      hdRouteSHI: this.hdRouteSHI,
      unsimplifiedRoute: this.unsimplifiedRoute,
    }
  }

  getOptimizedHdRoute(): HighDensityRoute {
    // TODO reconstruct the route from segments, we will need to recompute the
    // vias
    const route = this.routeSections.flatMap((section) => section.points)
    const vias: HighDensityRoute["vias"] = []
    for (let i = 0; i < route.length - 1; i++) {
      if (route[i].z !== route[i + 1].z) {
        vias.push({
          x: route[i].x,
          y: route[i].y,
        })
      }
    }
    return {
      connectionName: this.unsimplifiedRoute.connectionName,
      rootConnectionName: this.unsimplifiedRoute.rootConnectionName,
      route,
      traceThickness: this.unsimplifiedRoute.traceThickness,
      vias,
      viaDiameter: this.unsimplifiedRoute.viaDiameter,
      // Preserve jumpers from original route
      jumpers: this.unsimplifiedRoute.jumpers,
    }
  }
  visualize(): GraphicsObject {
    const graphics: GraphicsObject &
      Pick<Required<GraphicsObject>, "points" | "lines" | "rects" | "circles"> =
      {
        circles: [],
        lines: [],
        points: [],
        rects: [],
        coordinateSystem: "cartesian",
        title: "Single Route Useless Via Removal Solver",
      }

    // Draw the sections, draw the active section in orange

    for (let i = 0; i < this.routeSections.length; i++) {
      const section = this.routeSections[i]
      graphics.lines.push({
        points: section.points,
        strokeWidth: this.TRACE_THICKNESS,
        strokeColor:
          i === this.currentSectionIndex
            ? "orange"
            : section.z === 0
              ? "red"
              : "blue",
      })
    }

    return graphics
  }
}
