import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { BaseSolver } from "../BaseSolver"
import {
  HighDensityRoute,
  HighDensityRouteSpatialIndex,
} from "lib/data-structures/HighDensityRouteSpatialIndex"
import { GraphicsObject } from "graphics-debug"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { breakRouteIntoSections } from "./break-route-into-sections"
import { canEndpointConnectOnLayer } from "./can-endpoint-connect-on-layer"
import { canSectionMoveToLayer } from "./can-section-move-to-layer"
import type { RouteSection } from "./route-section"

export class SingleRouteUselessViaRemovalSolver extends BaseSolver {
  override getSolverName(): string {
    return "SingleRouteUselessViaRemovalSolver"
  }

  obstacleSHI: ObstacleSpatialHashIndex
  hdRouteSHI: HighDensityRouteSpatialIndex
  unsimplifiedRoute: HighDensityRoute
  connMap: ConnectivityMap

  routeSections: Array<RouteSection>

  currentSectionIndex: number

  TRACE_THICKNESS = 0.15
  OBSTACLE_MARGIN = 0.1

  constructor(params: {
    obstacleSHI: ObstacleSpatialHashIndex
    hdRouteSHI: HighDensityRouteSpatialIndex
    unsimplifiedRoute: HighDensityRoute
    connMap: ConnectivityMap
  }) {
    super()
    this.currentSectionIndex = 0 // Start at 0 to check first section for MLCP via removal
    this.obstacleSHI = params.obstacleSHI
    this.hdRouteSHI = params.hdRouteSHI
    this.unsimplifiedRoute = params.unsimplifiedRoute
    this.connMap = params.connMap

    this.routeSections = breakRouteIntoSections(this.unsimplifiedRoute)
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
        const endpointSupportsLayer = canEndpointConnectOnLayer({
          endpointX: firstPoint.x,
          endpointY: firstPoint.y,
          targetZ,
          obstacleSHI: this.obstacleSHI,
          route: this.unsimplifiedRoute,
        })
        if (
          endpointSupportsLayer &&
          canSectionMoveToLayer({
            currentSection: firstSection,
            targetZ,
            route: this.unsimplifiedRoute,
            hdRouteSHI: this.hdRouteSHI,
            obstacleSHI: this.obstacleSHI,
            connMap: this.connMap,
            defaultTraceThickness: this.TRACE_THICKNESS,
            obstacleMargin: this.OBSTACLE_MARGIN,
          })
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
          const endpointSupportsLayer = canEndpointConnectOnLayer({
            endpointX: lastPoint.x,
            endpointY: lastPoint.y,
            targetZ,
            obstacleSHI: this.obstacleSHI,
            route: this.unsimplifiedRoute,
          })
          if (
            endpointSupportsLayer &&
            canSectionMoveToLayer({
              currentSection: lastSection,
              targetZ,
              route: this.unsimplifiedRoute,
              hdRouteSHI: this.hdRouteSHI,
              obstacleSHI: this.obstacleSHI,
              connMap: this.connMap,
              defaultTraceThickness: this.TRACE_THICKNESS,
              obstacleMargin: this.OBSTACLE_MARGIN,
            })
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

    if (
      canSectionMoveToLayer({
        currentSection,
        targetZ,
        route: this.unsimplifiedRoute,
        hdRouteSHI: this.hdRouteSHI,
        obstacleSHI: this.obstacleSHI,
        connMap: this.connMap,
        defaultTraceThickness: this.TRACE_THICKNESS,
        obstacleMargin: this.OBSTACLE_MARGIN,
      })
    ) {
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

  getConstructorParams() {
    return {
      obstacleSHI: this.obstacleSHI,
      hdRouteSHI: this.hdRouteSHI,
      unsimplifiedRoute: this.unsimplifiedRoute,
      connMap: this.connMap,
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
