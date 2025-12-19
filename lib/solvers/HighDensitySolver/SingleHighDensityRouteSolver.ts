import { BaseSolver } from "../BaseSolver"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import {
  distance,
  pointToSegmentDistance,
  doSegmentsIntersect,
} from "@tscircuit/math-utils"
import type { GraphicsObject } from "graphics-debug"
import { HighDensityHyperParameters } from "./HighDensityHyperParameters"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"

export type FutureConnection = {
  connectionName: string
  points: { x: number; y: number; z: number }[]
}

export class SingleHighDensityRouteSolver extends BaseSolver {
  obstacleRoutes: HighDensityIntraNodeRoute[]
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  boundsSize: { width: number; height: number }
  boundsCenter: { x: number; y: number }
  A: { x: number; y: number; z: number }
  B: { x: number; y: number; z: number }
  straightLineDistance: number

  viaDiameter: number
  traceThickness: number
  obstacleMargin: number
  layerCount: number
  minCellSize = 0.05
  cellStep = 0.05
  GREEDY_MULTIPLER = 1.1
  numRoutes: number

  VIA_PENALTY_FACTOR = 0.3
  CELL_SIZE_FACTOR: number

  exploredNodes: Set<string>

  candidates: SingleRouteCandidatePriorityQueue

  connectionName: string
  solvedPath: HighDensityIntraNodeRoute | null = null

  futureConnections: FutureConnection[]
  hyperParameters: Partial<HighDensityHyperParameters>

  connMap?: ConnectivityMap

  /** For debugging/animating the exploration */
  debug_exploredNodesOrdered: string[]
  debug_nodesTooCloseToObstacle: Set<string>
  debug_nodePathToParentIntersectsObstacle: Set<string>

  debugEnabled = true

  initialNodeGridOffset: { x: number; y: number }

  constructor(opts: {
    connectionName: string
    obstacleRoutes: HighDensityIntraNodeRoute[]
    minDistBetweenEnteringPoints: number
    bounds: { minX: number; maxX: number; minY: number; maxY: number }
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
    viaDiameter?: number
    traceThickness?: number
    obstacleMargin?: number
    layerCount?: number
    futureConnections?: FutureConnection[]
    hyperParameters?: Partial<HighDensityHyperParameters>
    connMap?: ConnectivityMap
  }) {
    super()
    this.bounds = opts.bounds
    this.connMap = opts.connMap
    this.hyperParameters = opts.hyperParameters ?? {}
    this.CELL_SIZE_FACTOR = this.hyperParameters.CELL_SIZE_FACTOR ?? 1
    this.boundsSize = {
      width: this.bounds.maxX - this.bounds.minX,
      height: this.bounds.maxY - this.bounds.minY,
    }
    this.boundsCenter = {
      x: (this.bounds.minX + this.bounds.maxX) / 2,
      y: (this.bounds.minY + this.bounds.maxY) / 2,
    }
    this.connectionName = opts.connectionName
    this.obstacleRoutes = opts.obstacleRoutes
    this.A = opts.A
    this.B = opts.B
    this.viaDiameter = opts.viaDiameter ?? 0.6
    this.traceThickness = opts.traceThickness ?? 0.15
    this.obstacleMargin = opts.obstacleMargin ?? 0.2
    this.layerCount = opts.layerCount ?? 2
    this.exploredNodes = new Set()
    this.straightLineDistance = distance(this.A, this.B)
    this.futureConnections = opts.futureConnections ?? []
    this.MAX_ITERATIONS = 10e3 // 5000

    this.debug_exploredNodesOrdered = []
    this.debug_nodesTooCloseToObstacle = new Set()
    this.debug_nodePathToParentIntersectsObstacle = new Set()
    this.numRoutes = this.obstacleRoutes.length + this.futureConnections.length
    const bestRowOrColumnCount = Math.ceil(5 * (this.numRoutes + 1))
    let numXCells = this.boundsSize.width / this.cellStep
    let numYCells = this.boundsSize.height / this.cellStep

    while (numXCells * numYCells > bestRowOrColumnCount ** 2) {
      if (this.cellStep * 2 > opts.minDistBetweenEnteringPoints) {
        break
      }
      this.cellStep *= 2
      numXCells = this.boundsSize.width / this.cellStep
      numYCells = this.boundsSize.height / this.cellStep
    }

    this.cellStep *= this.CELL_SIZE_FACTOR

    const isOnSameEdge =
      (Math.abs(this.A.x - this.bounds.minX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.minX) < 0.001) || // both on left
      (Math.abs(this.A.x - this.bounds.maxX) < 0.001 &&
        Math.abs(this.B.x - this.bounds.maxX) < 0.001) || // both on right
      (Math.abs(this.A.y - this.bounds.minY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.minY) < 0.001) || // both on bottom
      (Math.abs(this.A.y - this.bounds.maxY) < 0.001 &&
        Math.abs(this.B.y - this.bounds.maxY) < 0.001) // both on top

    if (
      this.futureConnections &&
      this.futureConnections.length === 0 &&
      this.obstacleRoutes.length === 0 &&
      !isOnSameEdge
    ) {
      this.handleSimpleCases()
    }

    const initialNodePosition = {
      x: Math.round(opts.A.x / (this.cellStep / 2)) * (this.cellStep / 2),
      y: Math.round(opts.A.y / (this.cellStep / 2)) * (this.cellStep / 2),
    }
    this.initialNodeGridOffset = {
      x:
        initialNodePosition.x -
        Math.round(opts.A.x / this.cellStep) * this.cellStep,
      y:
        initialNodePosition.y -
        Math.round(opts.A.y / this.cellStep) * this.cellStep,
    }
    this.candidates = new SingleRouteCandidatePriorityQueue([
      {
        ...opts.A,
        ...initialNodePosition,
        z: opts.A.z ?? 0,
        g: 0,
        h: 0,
        f: 0,
        parent: {
          ...opts.A,
          z: opts.A.z ?? 0,
          g: 0,
          h: 0,
          f: 0,
          parent: null,
        },
      },
    ])
  }

  handleSimpleCases() {
    this.solved = true
    const { A, B } = this
    const route =
      A.z === B.z
        ? [A, B]
        : [
            A,
            { ...this.boundsCenter, z: this.A.z },
            {
              ...this.boundsCenter,
              z: B.z,
            },
            B,
          ]
    this.solvedPath = {
      connectionName: this.connectionName,
      route,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      vias: this.A.z === this.B.z ? [] : [this.boundsCenter],
    }
  }

  get viaPenaltyDistance() {
    return this.cellStep + this.straightLineDistance * this.VIA_PENALTY_FACTOR
  }

  isNodeTooCloseToObstacle(node: Node, margin?: number, isVia?: boolean) {
    margin ??= this.obstacleMargin

    if (isVia && node.parent) {
      const viasInMyRoute = this.getViasInNodePath(node.parent)
      for (const via of viasInMyRoute) {
        if (distance(node, via) < this.viaDiameter / 2 + margin) {
          return true
        }
      }
    }

    for (const route of this.obstacleRoutes) {
      const connectedToObstacle = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )

      if (!connectedToObstacle) {
        const pointPairs = getSameLayerPointPairs(route)
        for (const pointPair of pointPairs) {
          if (
            (isVia || pointPair.z === node.z) &&
            pointToSegmentDistance(node, pointPair.A, pointPair.B) <
              this.traceThickness + margin
          ) {
            return true
          }
        }
      }
      for (const via of route.vias) {
        if (
          distance(node, via) <
          this.viaDiameter / 2 + this.traceThickness / 2 + margin
        ) {
          return true
        }
      }
    }

    return false
  }

  isNodeTooCloseToEdge(node: Node, isVia?: boolean) {
    const margin = isVia
      ? this.viaDiameter / 2 + this.obstacleMargin / 2
      : this.obstacleMargin / 2
    const tooClose =
      node.x < this.bounds.minX + margin ||
      node.x > this.bounds.maxX - margin ||
      node.y < this.bounds.minY + margin ||
      node.y > this.bounds.maxY - margin
    if (tooClose && !isVia) {
      // If it's close to B or A it's an exception
      if (
        distance(node, this.B) < margin * 2 ||
        distance(node, this.A) < margin * 2
      ) {
        return false
      }
    }
    return tooClose
  }

  doesPathToParentIntersectObstacle(node: Node) {
    const parent = node.parent
    if (!parent) return false
    for (const route of this.obstacleRoutes) {
      const obstacleIsConnectedToNewPath = this.connMap?.areIdsConnected?.(
        this.connectionName,
        route.connectionName,
      )
      if (obstacleIsConnectedToNewPath) continue
      for (const pointPair of getSameLayerPointPairs(route)) {
        if (pointPair.z !== node.z) continue
        if (doSegmentsIntersect(node, parent, pointPair.A, pointPair.B)) {
          return true
        }
      }
    }
    return false
  }

  computeH(node: Node) {
    return (
      distance(node, this.B) +
      // via penalty (one via can reach any layer, so just check if layers differ)
      (node.z !== this.B.z ? this.viaPenaltyDistance : 0)
    )
  }

  computeG(node: Node) {
    return (
      (node.parent?.g ?? 0) +
      (node.z === node.parent?.z ? 0 : this.viaPenaltyDistance) +
      distance(node, node.parent!)
    )
  }

  computeF(g: number, h: number) {
    return g + h * this.GREEDY_MULTIPLER
  }

  getNodeKey(node: Node) {
    return `${Math.round(node.x / this.cellStep) * this.cellStep},${Math.round(node.y / this.cellStep) * this.cellStep},${node.z}`
  }

  getNeighbors(node: Node) {
    const neighbors: Node[] = []

    const { maxX, minX, maxY, minY } = this.bounds

    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        if (x === 0 && y === 0) continue

        const neighbor = {
          ...node,
          parent: node,
          x: clamp(node.x + x * this.cellStep, minX, maxX),
          y: clamp(node.y + y * this.cellStep, minY, maxY),
        }

        const neighborKey = this.getNodeKey(neighbor)

        if (this.exploredNodes.has(neighborKey)) {
          continue
        }

        if (this.isNodeTooCloseToObstacle(neighbor)) {
          this.debug_nodesTooCloseToObstacle.add(neighborKey)
          this.exploredNodes.add(neighborKey)
          continue
        }

        if (this.isNodeTooCloseToEdge(neighbor, false)) {
          this.exploredNodes.add(neighborKey)
          continue
        }

        if (this.doesPathToParentIntersectObstacle(neighbor)) {
          this.debug_nodePathToParentIntersectsObstacle.add(neighborKey)
          this.exploredNodes.add(neighborKey)
          continue
        }

        neighbor.g = this.computeG(neighbor)
        neighbor.h = this.computeH(neighbor)
        neighbor.f = this.computeF(neighbor.g, neighbor.h)

        neighbors.push(neighbor)
      }
    }

    // Add via neighbors for all other layers (a via can connect any layer to any other layer)
    for (let newZ = 0; newZ < this.layerCount; newZ++) {
      if (newZ === node.z) continue

      const viaNeighbor = {
        ...node,
        parent: node,
        z: newZ,
      }

      if (
        !this.exploredNodes.has(this.getNodeKey(viaNeighbor)) &&
        !this.isNodeTooCloseToObstacle(
          viaNeighbor,
          this.viaDiameter / 2 + this.obstacleMargin / 2,
          true,
        ) &&
        !this.isNodeTooCloseToEdge(viaNeighbor, true)
      ) {
        viaNeighbor.g = this.computeG(viaNeighbor)
        viaNeighbor.h = this.computeH(viaNeighbor)
        viaNeighbor.f = this.computeF(viaNeighbor.g, viaNeighbor.h)

        neighbors.push(viaNeighbor)
      }
    }

    return neighbors
  }

  getNodePath(node: Node) {
    const path: Node[] = []
    while (node) {
      path.push(node)
      node = node.parent!
    }
    return path
  }

  getViasInNodePath(node: Node) {
    const path = this.getNodePath(node)
    const vias: { x: number; y: number }[] = []
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i].z !== path[i + 1].z) {
        vias.push({ x: path[i].x, y: path[i].y })
      }
    }
    return vias
  }

  setSolvedPath(node: Node) {
    const path = this.getNodePath(node)
    path.reverse()

    const vias: { x: number; y: number }[] = []
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i].z !== path[i + 1].z) {
        vias.push({ x: path[i].x, y: path[i].y })
      }
    }

    this.solvedPath = {
      connectionName: this.connectionName,
      traceThickness: this.traceThickness,
      viaDiameter: this.viaDiameter,
      route: path
        .map((node) => ({ x: node.x, y: node.y, z: node.z }))
        .concat([this.B]),
      vias,
    }
  }

  computeProgress(currentNode: Node, goalDist: number, isOnLayer: boolean) {
    if (!isOnLayer) goalDist += this.viaPenaltyDistance
    const goalDistPercent = 1 - goalDist / this.straightLineDistance

    // This is a perfectly acceptable progress metric
    // return Math.max(this.progress || 0, goalDistPercent)

    // Linearize because it typically gets harder towards the end
    return Math.max(
      this.progress || 0,
      // 0.112 = ~90% -> 50%
      //         ~25% -> 2%
      //         ~99% -> 94%
      //         ~95% -> 72%
      (2 / Math.PI) *
        Math.atan((0.112 * goalDistPercent) / (1 - goalDistPercent)),
    )
  }

  _step() {
    let currentNode = this.candidates.dequeue()
    let currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined

    while (
      currentNode &&
      currentNodeKey &&
      this.exploredNodes.has(currentNodeKey)
    ) {
      currentNode = this.candidates.dequeue()
      currentNodeKey = currentNode ? this.getNodeKey(currentNode) : undefined
    }

    if (!currentNode || !currentNodeKey) {
      this.failed = true
      this.error = "Ran out of candidate nodes to explore"
      return
    }
    this.exploredNodes.add(currentNodeKey)
    this.debug_exploredNodesOrdered.push(currentNodeKey)

    const goalDist = distance(currentNode, this.B)

    this.progress = this.computeProgress(
      currentNode,
      goalDist,
      currentNode.z === this.B.z,
    )

    if (
      goalDist <= this.cellStep * Math.SQRT2 &&
      currentNode.z === this.B.z &&
      // Make sure the last segment doesn't intersect an obstacle
      !this.doesPathToParentIntersectObstacle({
        ...currentNode,
        parent: currentNode,
        x: this.B.x,
        y: this.B.y,
      })
    ) {
      this.solved = true
      this.setSolvedPath(currentNode)
    }

    const neighbors = this.getNeighbors(currentNode)
    for (const neighbor of neighbors) {
      this.candidates.enqueue(neighbor)
    }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Display the input port points (from nodeWithPortPoints via A and B)
    graphics.points!.push({
      x: this.A.x,
      y: this.A.y,
      label: `Input A\nz: ${this.A.z}`,
      color: "orange",
    })
    graphics.points!.push({
      x: this.B.x,
      y: this.B.y,
      label: `Input B\nz: ${this.B.z}`,
      color: "orange",
    })

    // Draw circles at future connection points
    // if ("FUTURE_CONNECTION_PROXIMITY_VD" in this) {
    //   for (const futureConnection of this.futureConnections) {
    //     for (const point of futureConnection.points) {
    //       graphics.circles!.push({
    //         center: point,
    //         radius:
    //           (this.viaDiameter *
    //             (this.FUTURE_CONNECTION_PROXIMITY_VD as number)) /
    //           2,
    //         // strokeColor: "rgba(0, 255, 0, 0.3)",
    //         stroke: "rgba(0,255,0,0.1)",
    //         label: `Future Connection: ${futureConnection.connectionName}`,
    //       })
    //     }
    //   }
    //   // Draw circles around obstacle route points
    //   for (const route of this.obstacleRoutes) {
    //     for (const point of [
    //       route.route[0],
    //       route.route[route.route.length - 1],
    //     ]) {
    //       graphics.circles!.push({
    //         center: point,
    //         radius:
    //           (this.viaDiameter *
    //             (this.FUTURE_CONNECTION_PROXIMITY_VD as number)) /
    //           2,
    //         stroke: "rgba(255,0,0,0.1)",
    //         label: "Obstacle Route Point",
    //       })
    //     }
    //   }
    // }

    // Draw a line representing the direct connection between the input port points
    graphics.lines!.push({
      points: [this.A, this.B],
      strokeColor: "rgba(255, 0, 0, 0.5)",
      label: "Direct Input Connection",
    })

    // Show any obstacle routes as background references
    for (
      let routeIndex = 0;
      routeIndex < this.obstacleRoutes.length;
      routeIndex++
    ) {
      const route = this.obstacleRoutes[routeIndex]
      for (let i = 0; i < route.route.length - 1; i++) {
        const z = route.route[i].z
        graphics.lines!.push({
          points: [route.route[i], route.route[i + 1]],
          strokeColor:
            z === 0 ? "rgba(255, 0, 0, 0.75)" : "rgba(255, 128, 0, 0.25)",
          strokeWidth: route.traceThickness,
          label: "Obstacle Route",
          layer: `obstacle${routeIndex.toString()}`,
        })
      }
    }

    // Optionally, visualize explored nodes for debugging purposes
    for (let i = 0; i < this.debug_exploredNodesOrdered.length; i++) {
      const nodeKey = this.debug_exploredNodesOrdered[i]
      const [x, y, z] = nodeKey.split(",").map(Number)
      if (this.debug_nodesTooCloseToObstacle.has(nodeKey)) continue
      if (this.debug_nodePathToParentIntersectsObstacle.has(nodeKey)) continue
      graphics.rects!.push({
        center: {
          x: x + this.initialNodeGridOffset.x + (z * this.cellStep) / 20,
          y: y + this.initialNodeGridOffset.y + (z * this.cellStep) / 20,
        },
        fill:
          z === 0
            ? `rgba(255,0,255,${0.3 - (i / this.debug_exploredNodesOrdered.length) * 0.2})`
            : `rgba(0,0,255,${0.3 - (i / this.debug_exploredNodesOrdered.length) * 0.2})`,
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label: `Explored (z=${z})`,
      })
    }

    // Visualize the next node to be explored
    if (this.candidates.peek()) {
      const nextNode = this.candidates.peek()!
      graphics.rects!.push({
        center: {
          x: nextNode.x + (nextNode.z * this.cellStep) / 20,
          y: nextNode.y + (nextNode.z * this.cellStep) / 20,
        },
        fill: "rgba(0, 255, 0, 0.8)",
        width: this.cellStep * 0.9,
        height: this.cellStep * 0.9,
        label: `Next (z=${nextNode.z})`,
      })
    }

    // Visualize vias from obstacle routes
    for (const route of this.obstacleRoutes) {
      for (const via of route.vias) {
        graphics.circles!.push({
          center: {
            x: via.x,
            y: via.y,
          },
          radius: this.viaDiameter / 2,
          fill: "rgba(255, 0, 0, 0.5)",
          label: "Via",
        })
      }
    }
    // If a solved route exists, display it along with via markers
    if (this.solvedPath) {
      graphics.lines!.push({
        points: this.solvedPath.route,
        strokeColor: "green",
        label: "Solved Route",
      })
      for (const via of this.solvedPath.vias) {
        graphics.circles!.push({
          center: via,
          radius: this.viaDiameter / 2,
          fill: "green",
          label: "Via",
        })
      }
    }

    return graphics
  }
}

function getSameLayerPointPairs(route: HighDensityIntraNodeRoute) {
  const pointPairs: {
    z: number
    A: { x: number; y: number; z: number }
    B: { x: number; y: number; z: number }
  }[] = []

  for (let i = 0; i < route.route.length - 1; i++) {
    if (route.route[i].z === route.route[i + 1].z) {
      pointPairs.push({
        z: route.route[i].z,
        A: route.route[i],
        B: route.route[i + 1],
      })
    }
  }

  return pointPairs
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max))
}
