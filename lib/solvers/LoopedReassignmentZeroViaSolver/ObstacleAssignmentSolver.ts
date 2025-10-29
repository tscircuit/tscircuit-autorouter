import {
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
  Obstacle,
} from "lib/types"
import { BaseSolver } from "../BaseSolver"
import { AutoroutingPipelineSolverOptions } from "../AutoroutingPipelineSolver"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { GraphicsObject } from "graphics-debug"

interface ObstacleAssignmentSolverInput {
  inputSrj: SimpleRouteJson
  vias: Array<{
    x: number
    y: number
    fromLayer: string
    toLayer: string
    trace: SimplifiedPcbTrace
  }>
  routesWithVias?: SimplifiedPcbTraces
}

interface ObstacleWithIndex {
  obstacle: Obstacle
  index: number
}

interface ClosestObstacle extends ObstacleWithIndex {
  distance: number
}

export class ObstacleAssignmentSolver extends BaseSolver {
  inputSrj: SimpleRouteJson
  outputSrj?: SimpleRouteJson
  vias: Array<{
    x: number
    y: number
    fromLayer: string
    toLayer: string
    trace: SimplifiedPcbTrace
  }>
  routesWithVias?: SimplifiedPcbTraces
  currentViaIndex: number = 0
  newlyAssignedObstacleIndices: Set<number> = new Set()

  constructor(input: ObstacleAssignmentSolverInput) {
    super()
    this.inputSrj = input.inputSrj
    this.vias = input.vias
    this.routesWithVias = input.routesWithVias
  }

  _step() {
    // Initialize output SRJ on first step
    if (!this.outputSrj) {
      this.outputSrj = structuredClone(this.inputSrj)
    }

    // Check if all vias have been processed
    if (this.currentViaIndex >= this.vias.length) {
      this.solved = true
      return
    }

    // Find assignable obstacles
    const assignableObstacles = this.getAssignableObstacles()
    if (assignableObstacles.length === 0) {
      this.solved = true
      return
    }

    // Process one via per iteration
    const via = this.vias[this.currentViaIndex]
    const closestObstacle = this.findClosestObstacleForVia(
      via,
      assignableObstacles,
    )

    if (closestObstacle) {
      this.assignObstacleToVia(closestObstacle, via)
    }

    this.currentViaIndex++
  }

  private getAssignableObstacles() {
    if (!this.outputSrj) {
      throw new Error("outputSrj should be defined")
    }

    return this.outputSrj.obstacles
      .map((obstacle, index) => ({ obstacle, index }))
      .filter(({ obstacle }) => obstacle.netIsAssignable)
  }

  private findClosestObstacleForVia(
    via: { x: number; y: number; fromLayer: string; toLayer: string },
    assignableObstacles: ObstacleWithIndex[],
  ) {
    let closestObstacle: ClosestObstacle | null = null

    for (const { obstacle, index } of assignableObstacles) {
      // Check if the obstacle is on one of the via's layers
      const isOnViaLayer =
        obstacle.layers.includes(via.fromLayer) ||
        obstacle.layers.includes(via.toLayer)

      if (!isOnViaLayer) continue

      // Calculate distance from via to obstacle center
      const distance = Math.sqrt(
        (via.x - obstacle.center.x) ** 2 + (via.y - obstacle.center.y) ** 2,
      )

      if (closestObstacle === null || distance < closestObstacle.distance) {
        closestObstacle = { obstacle, index, distance }
      }
    }

    return closestObstacle
  }

  private assignObstacleToVia(
    closestObstacle: ObstacleWithIndex,
    via: { fromLayer: string; toLayer: string; trace: SimplifiedPcbTrace },
  ) {
    if (!this.outputSrj) return

    const obstacle = this.outputSrj.obstacles[closestObstacle.index]
    const connectionName = via.trace.connection_name

    // Mark obstacle as assigned
    obstacle.netIsAssignable = false
    this.newlyAssignedObstacleIndices.add(closestObstacle.index)

    // Split the connection into two layer-specific connections
    this.splitConnectionForObstacle(obstacle, via, connectionName)
  }

  private splitConnectionForObstacle(
    obstacle: Obstacle,
    via: { fromLayer: string; toLayer: string },
    connectionName: string,
  ) {
    if (!this.outputSrj) return

    const connectionIndex = this.outputSrj.connections.findIndex(
      (c) => c.name === connectionName,
    )

    if (connectionIndex === -1) {
      // Connection not found, just add it to the obstacle
      this.addConnectionToObstacle(obstacle, connectionName)
      return
    }

    const originalConnection = this.outputSrj.connections[connectionIndex]
    const fromLayerPoints = originalConnection.pointsToConnect.filter(
      (p) => p.layer === via.fromLayer,
    )
    const toLayerPoints = originalConnection.pointsToConnect.filter(
      (p) => p.layer === via.toLayer,
    )

    // Check if we have points on both layers
    if (fromLayerPoints.length === 0 || toLayerPoints.length === 0) {
      // All points are on the same layer - need to split spatially
      // This typically happens when routing between two pads on the same layer
      // that requires a via to route through the other layer

      if (originalConnection.pointsToConnect.length !== 2) {
        // Can't handle connections with more than 2 points in this case
        this.addConnectionToObstacle(obstacle, connectionName)
        return
      }

      const [point1, point2] = originalConnection.pointsToConnect

      // Create two new connections split at the via
      const connection1Name = `${connectionName}_${via.fromLayer}`
      const connection2Name = `${connectionName}_${via.toLayer}`

      const connection1 = {
        ...originalConnection,
        name: connection1Name,
        pointsToConnect: [
          point1,
          { x: obstacle.center.x, y: obstacle.center.y, layer: via.fromLayer },
        ],
      }

      const connection2 = {
        ...originalConnection,
        name: connection2Name,
        pointsToConnect: [
          { x: obstacle.center.x, y: obstacle.center.y, layer: via.toLayer },
          point2,
        ],
      }

      // Update obstacle connections
      this.replaceObstacleConnection(obstacle, connectionName, [
        connection1Name,
        connection2Name,
      ])

      // Replace original connection with split connections
      this.outputSrj.connections.splice(connectionIndex, 1)
      this.outputSrj.connections.push(connection1, connection2)
      return
    }

    // Create two new single-layer connections
    const connection1Name = `${connectionName}_${via.fromLayer}`
    const connection2Name = `${connectionName}_${via.toLayer}`

    const connection1 = {
      ...originalConnection,
      name: connection1Name,
      pointsToConnect: [
        ...fromLayerPoints,
        { x: obstacle.center.x, y: obstacle.center.y, layer: via.fromLayer },
      ],
    }

    const connection2 = {
      ...originalConnection,
      name: connection2Name,
      pointsToConnect: [
        ...toLayerPoints,
        { x: obstacle.center.x, y: obstacle.center.y, layer: via.toLayer },
      ],
    }

    // Update obstacle connections
    this.replaceObstacleConnection(obstacle, connectionName, [
      connection1Name,
      connection2Name,
    ])

    // Replace original connection with split connections
    this.outputSrj.connections.splice(connectionIndex, 1)
    this.outputSrj.connections.push(connection1, connection2)
  }

  private addConnectionToObstacle(obstacle: Obstacle, connectionName: string) {
    if (!obstacle.connectedTo.includes(connectionName)) {
      obstacle.connectedTo.push(connectionName)
    }
  }

  private replaceObstacleConnection(
    obstacle: Obstacle,
    oldConnectionName: string,
    newConnectionNames: string[],
  ) {
    // Remove the original connection name
    const originalIdx = obstacle.connectedTo.indexOf(oldConnectionName)
    if (originalIdx !== -1) {
      obstacle.connectedTo.splice(originalIdx, 1)
    }

    // Add the new connection names
    for (const newName of newConnectionNames) {
      if (!obstacle.connectedTo.includes(newName)) {
        obstacle.connectedTo.push(newName)
      }
    }
  }

  getOutputSrj(): SimpleRouteJson {
    if (!this.outputSrj) {
      throw new Error("ObstacleAssignmentSolver has not been solved yet")
    }
    return this.outputSrj
  }

  visualize(): GraphicsObject {
    // Start with regular SRJ visualization
    const srjToVisualize = this.outputSrj ?? this.inputSrj
    const graphicsObject = convertSrjToGraphicsObject(srjToVisualize)
    const layerCount = 2

    // Add strokes and labels to obstacles where netIsAssignable or newly assigned
    graphicsObject.rects = srjToVisualize.obstacles.map((obstacle, index) => {
      const isAssignable = obstacle.netIsAssignable
      const isNewlyAssigned = this.newlyAssignedObstacleIndices.has(index)

      let stroke = "none"
      let strokeWidth = 0

      if (isNewlyAssigned) {
        // Green stroke for newly assigned obstacles
        stroke = "rgba(0, 255, 0, 1)"
        strokeWidth = 0.05
      } else if (isAssignable) {
        // Magenta stroke for assignable obstacles
        stroke = "rgba(255, 0, 255, 1)"
        strokeWidth = 0.05
      }

      // Build label showing layers and connections
      const layerInfo = `Layers: ${obstacle.layers.join(", ")}`
      const connectionInfo =
        obstacle.connectedTo.length > 0
          ? `Connected: ${obstacle.connectedTo.join(", ")}`
          : "Unconnected"
      const assignableInfo = isAssignable ? " (assignable)" : ""
      const newlyAssignedInfo = isNewlyAssigned ? " (newly assigned)" : ""
      const label = `${layerInfo}\n${connectionInfo}${assignableInfo}${newlyAssignedInfo}`

      return {
        center: obstacle.center,
        width: obstacle.width,
        height: obstacle.height,
        fill: "rgba(255,0,0,0.5)",
        layer: `z${obstacle.layers.map((l) => mapLayerNameToZ(l, layerCount)).join(",")}`,
        stroke,
        strokeWidth,
        label,
      }
    })

    // Add all pointsToConnect as circles
    if (!graphicsObject.circles) {
      graphicsObject.circles = []
    }
    for (const connection of srjToVisualize.connections) {
      for (const point of connection.pointsToConnect) {
        graphicsObject.circles.push({
          center: { x: point.x, y: point.y },
          radius: 0.15,
          fill: "rgba(0, 0, 255, 0.7)",
          stroke: "rgba(0, 0, 255, 1)",
          layer: `z${mapLayerNameToZ(point.layer, layerCount)}`,
          label: `${connection.name}\n${point.layer}`,
        })
      }
    }

    // Visualize routes with vias if provided
    if (this.routesWithVias) {
      if (!graphicsObject.lines) {
        graphicsObject.lines = []
      }

      for (const trace of this.routesWithVias) {
        // Group consecutive wire segments on the same layer into lines
        let currentLine: Array<{ x: number; y: number }> = []
        let currentLayer: string | null = null

        for (const segment of trace.route) {
          if (segment.route_type === "wire") {
            // Start a new line if layer changed or if this is the first segment
            if (currentLayer !== segment.layer) {
              // Save previous line if it exists
              if (currentLine.length > 0 && currentLayer) {
                // Color based on layer: red for top, blue for bottom
                const strokeColor =
                  currentLayer === "top"
                    ? "rgba(255, 0, 0, 0.8)" // Red for top
                    : "rgba(0, 0, 255, 0.8)" // Blue for bottom

                graphicsObject.lines.push({
                  points: currentLine,
                  strokeColor,
                  strokeWidth: 0.08,
                  layer: `z${mapLayerNameToZ(currentLayer, layerCount)}`,
                })
              }
              // Start new line
              currentLine = [{ x: segment.x, y: segment.y }]
              currentLayer = segment.layer
            } else {
              // Continue current line
              currentLine.push({ x: segment.x, y: segment.y })
            }
          } else if (segment.route_type === "via") {
            // Save current line before the via
            if (currentLine.length > 0 && currentLayer) {
              // Color based on layer: red for top, blue for bottom
              const strokeColor =
                currentLayer === "top"
                  ? "rgba(255, 0, 0, 0.8)" // Red for top
                  : "rgba(0, 0, 255, 0.8)" // Blue for bottom

              graphicsObject.lines.push({
                points: currentLine,
                strokeColor,
                strokeWidth: 0.08,
                layer: `z${mapLayerNameToZ(currentLayer, layerCount)}`,
              })
              currentLine = []
            }

            // Add via as a circle
            graphicsObject.circles.push({
              center: { x: segment.x, y: segment.y },
              radius: 0.12,
              fill: "rgba(255, 165, 0, 0.8)",
              stroke: "rgba(255, 140, 0, 1)",
              layer: `z${mapLayerNameToZ(segment.from_layer, layerCount)},z${mapLayerNameToZ(segment.to_layer, layerCount)}`,
            })

            // Start a new line on the new layer
            currentLine = [{ x: segment.x, y: segment.y }]
            currentLayer = segment.to_layer
          }
        }

        // Save final line if it exists
        if (currentLine.length > 0 && currentLayer) {
          // Color based on layer: red for top, blue for bottom
          const strokeColor =
            currentLayer === "top"
              ? "rgba(255, 0, 0, 0.8)" // Red for top
              : "rgba(0, 0, 255, 0.8)" // Blue for bottom

          graphicsObject.lines.push({
            points: currentLine,
            strokeColor,
            strokeWidth: 0.08,
            layer: `z${mapLayerNameToZ(currentLayer, layerCount)}`,
          })
        }
      }
    }

    return graphicsObject
  }
}
