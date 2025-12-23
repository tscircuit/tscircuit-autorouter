import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"
import { safeTransparentize } from "../../solvers/colors"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"

const STEPS_PER_NODE = 10
const BORDER_MARGIN = 0.3
const POINT_FORCE_STRENGTH = 0.002
const BORDER_FORCE_STRENGTH = 0.1
const MOVABLE_POINT_OFFSET = 0.1

/**
 * Find the closest point on line segment AB to point P
 * Returns the closest point and the squared distance to it
 */
function closestPointOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; distSq: number } {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay

  const abLenSq = abx * abx + aby * aby

  if (abLenSq === 0) {
    // Segment is a point
    const distSq = apx * apx + apy * apy
    return { x: ax, y: ay, distSq }
  }

  // Project P onto line AB, clamped to [0, 1]
  let t = (apx * abx + apy * aby) / abLenSq
  t = Math.max(0, Math.min(1, t))

  const closestX = ax + t * abx
  const closestY = ay + t * aby

  const dx = px - closestX
  const dy = py - closestY
  const distSq = dx * dx + dy * dy

  return { x: closestX, y: closestY, distSq }
}

interface MovablePoint {
  x: number
  y: number
  z: number
  rootConnectionName?: string
  connectionName: string
  forceX?: number
  forceY?: number
}

interface RouteInProgress {
  connectionName: string
  rootConnectionName?: string
  startPoint: { x: number; y: number; z: number }
  endPoint: { x: number; y: number; z: number }
  movablePoints: MovablePoint[]
}

/**
 * A simplified high density solver that directly connects port points
 * within each node without considering intersections or vias.
 *
 * This solver creates 3-segment lines (4 points) for each connection and uses
 * a force-directed approach to push movable points away from borders and
 * other movable points with different rootConnectionName.
 *
 * Only solves intra-node routing - connecting port points within a single node.
 */
export class SimpleHighDensitySolver extends BaseSolver {
  unsolvedNodes: NodeWithPortPoints[]
  allNodes: NodeWithPortPoints[]
  routes: HighDensityIntraNodeRoute[]
  colorMap: Record<string, string>
  traceWidth: number
  viaDiameter: number
  numMovablePoints: number

  // State for current node being processed
  currentNode: NodeWithPortPoints | null = null
  currentNodeStep: number = 0
  routesInProgress: RouteInProgress[] = []
  pushMargin: number
  currentNodeBounds: {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null = null

  constructor({
    nodePortPoints,
    colorMap,
    traceWidth = 0.1,
    viaDiameter = 0.6,
    pushMargin = 0.3,
    numMovablePoints = 2,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    traceWidth?: number
    viaDiameter?: number
    numMovablePoints?: number
    pushMargin?: number
  }) {
    super()
    if (numMovablePoints < 1 || numMovablePoints > 3) {
      throw new Error(
        `numMovablePoints must be 1, 2, or 3, got ${numMovablePoints}`,
      )
    }
    this.allNodes = [...nodePortPoints]
    this.unsolvedNodes = [...nodePortPoints]
    this.colorMap = colorMap ?? {}
    this.routes = []
    this.traceWidth = traceWidth
    this.viaDiameter = viaDiameter
    this.numMovablePoints = numMovablePoints
    this.pushMargin = pushMargin
    this.MAX_ITERATIONS = nodePortPoints.length * STEPS_PER_NODE + 1
  }

  _step() {
    // If no current node, get the next one
    if (this.currentNode === null) {
      if (this.unsolvedNodes.length === 0) {
        this.solved = true
        return
      }

      this.currentNode = this.unsolvedNodes.pop()!
      this.currentNodeStep = 0
      this.routesInProgress = []
      this._initializeRoutesForCurrentNode()
    }

    // First step initializes, remaining steps run force-directed solver
    if (this.currentNodeStep > 0) {
      this._runForceDirectedStep()
    }

    this.currentNodeStep++

    // Check if we've spent enough steps on this node
    if (this.currentNodeStep >= STEPS_PER_NODE) {
      this._finalizeRoutesForCurrentNode()
      this.currentNode = null
    }
  }

  _initializeRoutesForCurrentNode() {
    const node = this.currentNode!

    // Compute node bounds from port points
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const pt of node.portPoints) {
      minX = Math.min(minX, pt.x)
      maxX = Math.max(maxX, pt.x)
      minY = Math.min(minY, pt.y)
      maxY = Math.max(maxY, pt.y)
    }
    this.currentNodeBounds = { minX, maxX, minY, maxY }

    // Group port points within this node by connectionName
    const connectionGroups = new Map<
      string,
      Array<{ x: number; y: number; z: number; rootConnectionName?: string }>
    >()

    for (const pt of node.portPoints) {
      if (!connectionGroups.has(pt.connectionName)) {
        connectionGroups.set(pt.connectionName, [])
      }
      connectionGroups.get(pt.connectionName)!.push({
        x: pt.x,
        y: pt.y,
        z: pt.z,
        rootConnectionName: pt.rootConnectionName,
      })
    }

    // Create routes in progress for connections with 2+ port points
    for (const [connectionName, points] of connectionGroups) {
      if (points.length < 2) continue

      const startPoint = points[0]
      const endPoint = points[points.length - 1]
      const z = startPoint.z

      // Calculate direction vector and length
      const dx = endPoint.x - startPoint.x
      const dy = endPoint.y - startPoint.y
      const length = Math.sqrt(dx * dx + dy * dy)
      const unitX = length > 0 ? dx / length : 0
      const unitY = length > 0 ? dy / length : 0

      // Create movable points based on numMovablePoints
      const movablePoints: MovablePoint[] = []

      if (this.numMovablePoints >= 1) {
        // First movable point: start + 0.1mm along line
        movablePoints.push({
          x: startPoint.x + unitX * MOVABLE_POINT_OFFSET,
          y: startPoint.y + unitY * MOVABLE_POINT_OFFSET,
          z,
          rootConnectionName: startPoint.rootConnectionName,
          connectionName,
        })
      }

      if (this.numMovablePoints >= 2) {
        // Second movable point: end - 0.1mm along line
        movablePoints.push({
          x: endPoint.x - unitX * MOVABLE_POINT_OFFSET,
          y: endPoint.y - unitY * MOVABLE_POINT_OFFSET,
          z,
          rootConnectionName: startPoint.rootConnectionName,
          connectionName,
        })
      }

      if (this.numMovablePoints >= 3) {
        // Third movable point: centered
        movablePoints.push({
          x: startPoint.x + dx / 2,
          y: startPoint.y + dy / 2,
          z,
          rootConnectionName: startPoint.rootConnectionName,
          connectionName,
        })
      }

      this.routesInProgress.push({
        connectionName,
        rootConnectionName: startPoint.rootConnectionName,
        startPoint: { x: startPoint.x, y: startPoint.y, z },
        endPoint: { x: endPoint.x, y: endPoint.y, z },
        movablePoints,
      })
    }
  }

  _runForceDirectedStep() {
    const bounds = this.currentNodeBounds!

    // Collect all movable points
    const allMovablePoints: MovablePoint[] = []
    for (const route of this.routesInProgress) {
      allMovablePoints.push(...route.movablePoints)
    }

    // Initialize force accumulators
    const forces = new Map<MovablePoint, { fx: number; fy: number }>()
    for (const point of allMovablePoints) {
      forces.set(point, { fx: 0, fy: 0 })
    }

    const forceEffectMargin = BORDER_MARGIN + this.pushMargin

    // Build segment info for each route (with references to movable points)
    type SegmentInfo = {
      x: number
      y: number
      movablePoint: MovablePoint | null // null if this is a fixed point (start/end)
    }

    const routeSegments = new Map<RouteInProgress, SegmentInfo[]>()
    for (const route of this.routesInProgress) {
      const segmentPoints: SegmentInfo[] = [
        { x: route.startPoint.x, y: route.startPoint.y, movablePoint: null },
      ]

      if (route.movablePoints.length === 1) {
        segmentPoints.push({
          x: route.movablePoints[0].x,
          y: route.movablePoints[0].y,
          movablePoint: route.movablePoints[0],
        })
      } else if (route.movablePoints.length === 2) {
        segmentPoints.push({
          x: route.movablePoints[0].x,
          y: route.movablePoints[0].y,
          movablePoint: route.movablePoints[0],
        })
        segmentPoints.push({
          x: route.movablePoints[1].x,
          y: route.movablePoints[1].y,
          movablePoint: route.movablePoints[1],
        })
      } else if (route.movablePoints.length === 3) {
        segmentPoints.push({
          x: route.movablePoints[0].x,
          y: route.movablePoints[0].y,
          movablePoint: route.movablePoints[0],
        })
        segmentPoints.push({
          x: route.movablePoints[2].x,
          y: route.movablePoints[2].y,
          movablePoint: route.movablePoints[2],
        }) // center
        segmentPoints.push({
          x: route.movablePoints[1].x,
          y: route.movablePoints[1].y,
          movablePoint: route.movablePoints[1],
        })
      }

      segmentPoints.push({
        x: route.endPoint.x,
        y: route.endPoint.y,
        movablePoint: null,
      })

      routeSegments.set(route, segmentPoints)
    }

    // Calculate forces for each movable point
    for (const point of allMovablePoints) {
      const pointForce = forces.get(point)!

      // 1. Border repulsion forces
      const distToLeft = point.x - bounds.minX
      const distToRight = bounds.maxX - point.x
      const distToTop = bounds.maxY - point.y
      const distToBottom = point.y - bounds.minY

      if (distToLeft < forceEffectMargin) {
        pointForce.fx +=
          BORDER_FORCE_STRENGTH * (forceEffectMargin - distToLeft)
      }
      if (distToRight < forceEffectMargin) {
        pointForce.fx -=
          BORDER_FORCE_STRENGTH * (forceEffectMargin - distToRight)
      }
      if (distToBottom < forceEffectMargin) {
        pointForce.fy +=
          BORDER_FORCE_STRENGTH * (forceEffectMargin - distToBottom)
      }
      if (distToTop < forceEffectMargin) {
        pointForce.fy -= BORDER_FORCE_STRENGTH * (forceEffectMargin - distToTop)
      }

      // 2. Repulsion from segments of other connections (different rootConnectionName)
      for (const otherRoute of this.routesInProgress) {
        if (otherRoute.rootConnectionName === point.rootConnectionName) continue

        const segmentPoints = routeSegments.get(otherRoute)!

        // Find closest point on any segment of this route
        for (let i = 0; i < segmentPoints.length - 1; i++) {
          const segA = segmentPoints[i]
          const segB = segmentPoints[i + 1]

          const closest = closestPointOnSegment(
            point.x,
            point.y,
            segA.x,
            segA.y,
            segB.x,
            segB.y,
          )

          const dist = Math.sqrt(closest.distSq)

          if (dist > 0 && dist < forceEffectMargin * 2) {
            const dx = point.x - closest.x
            const dy = point.y - closest.y
            const force = POINT_FORCE_STRENGTH / closest.distSq
            const forceX = force * dx
            const forceY = force * dy

            // Apply force to the point being pushed
            pointForce.fx += forceX
            pointForce.fy += forceY

            // Apply reciprocal force to the movable points on the segment
            const movableA = segA.movablePoint
            const movableB = segB.movablePoint

            if (movableA && movableB) {
              // Both endpoints are movable - distribute force equally
              const forceA = forces.get(movableA)!
              const forceB = forces.get(movableB)!
              forceA.fx -= forceX / 2
              forceA.fy -= forceY / 2
              forceB.fx -= forceX / 2
              forceB.fy -= forceY / 2
            } else if (movableA) {
              // Only A is movable - all reciprocal force goes to A
              const forceA = forces.get(movableA)!
              forceA.fx -= forceX
              forceA.fy -= forceY
            } else if (movableB) {
              // Only B is movable - all reciprocal force goes to B
              const forceB = forces.get(movableB)!
              forceB.fx -= forceX
              forceB.fy -= forceY
            }
            // If both are fixed points, the reciprocal force is absorbed
          }
        }
      }
    }

    // Apply accumulated forces to all points
    for (const point of allMovablePoints) {
      const pointForce = forces.get(point)!

      // Store forces for visualization
      point.forceX = pointForce.fx
      point.forceY = pointForce.fy

      // Apply forces
      point.x += pointForce.fx
      point.y += pointForce.fy

      // Clamp to bounds
      point.x = Math.max(bounds.minX, Math.min(bounds.maxX, point.x))
      point.y = Math.max(bounds.minY, Math.min(bounds.maxY, point.y))
    }
  }

  _finalizeRoutesForCurrentNode() {
    for (const routeInProgress of this.routesInProgress) {
      const {
        connectionName,
        rootConnectionName,
        startPoint,
        endPoint,
        movablePoints,
      } = routeInProgress

      // Build route: start -> movable points (in order) -> end
      const routePointList: Array<{ x: number; y: number; z: number }> = [
        { x: startPoint.x, y: startPoint.y, z: startPoint.z },
      ]

      // Add movable points in the correct order for the path
      // For 1 point: start -> M1 -> end
      // For 2 points: start -> M1 -> M2 -> end
      // For 3 points: start -> M1 -> M3 (center) -> M2 -> end
      if (movablePoints.length === 1) {
        routePointList.push({
          x: movablePoints[0].x,
          y: movablePoints[0].y,
          z: movablePoints[0].z,
        })
      } else if (movablePoints.length === 2) {
        routePointList.push({
          x: movablePoints[0].x,
          y: movablePoints[0].y,
          z: movablePoints[0].z,
        })
        routePointList.push({
          x: movablePoints[1].x,
          y: movablePoints[1].y,
          z: movablePoints[1].z,
        })
      } else if (movablePoints.length === 3) {
        routePointList.push({
          x: movablePoints[0].x,
          y: movablePoints[0].y,
          z: movablePoints[0].z,
        })
        routePointList.push({
          x: movablePoints[2].x,
          y: movablePoints[2].y,
          z: movablePoints[2].z,
        }) // center
        routePointList.push({
          x: movablePoints[1].x,
          y: movablePoints[1].y,
          z: movablePoints[1].z,
        })
      }

      routePointList.push({ x: endPoint.x, y: endPoint.y, z: endPoint.z })

      const route: HighDensityIntraNodeRoute = {
        connectionName,
        rootConnectionName,
        traceThickness: this.traceWidth,
        viaDiameter: this.viaDiameter,
        route: routePointList,
        vias: [],
      }

      this.routes.push(route)
    }

    this.routesInProgress = []
  }

  _getNodeBounds(node: NodeWithPortPoints): {
    minX: number
    maxX: number
    minY: number
    maxY: number
  } {
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const pt of node.portPoints) {
      minX = Math.min(minX, pt.x)
      maxX = Math.max(maxX, pt.x)
      minY = Math.min(minY, pt.y)
      maxY = Math.max(maxY, pt.y)
    }
    return { minX, maxX, minY, maxY }
  }

  visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    // Draw unsolved nodes with faded backgrounds
    for (const node of this.unsolvedNodes) {
      if (node === this.currentNode) continue
      const bounds = this._getNodeBounds(node)
      graphics.rects!.push({
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        fill: "rgba(0, 0, 0, 0.08)",
        stroke: "rgba(0, 0, 0, 0.2)",
      })
    }

    // Draw current node in green
    if (this.currentNode) {
      const bounds = this._getNodeBounds(this.currentNode)
      graphics.rects!.push({
        center: {
          x: (bounds.minX + bounds.maxX) / 2,
          y: (bounds.minY + bounds.maxY) / 2,
        },
        width: bounds.maxX - bounds.minX,
        height: bounds.maxY - bounds.minY,
        fill: "rgba(0, 200, 0, 0.15)",
        stroke: "rgba(0, 200, 0, 0.6)",
      })
    }

    // Draw unsolved nodes in gray
    for (const node of this.unsolvedNodes) {
      // Group port points by connectionName
      const connectionGroups = new Map<
        string,
        Array<{ x: number; y: number }>
      >()
      for (const pt of node.portPoints) {
        if (!connectionGroups.has(pt.connectionName)) {
          connectionGroups.set(pt.connectionName, [])
        }
        connectionGroups.get(pt.connectionName)!.push({ x: pt.x, y: pt.y })
      }

      // Draw gray lines for each connection
      for (const [connectionName, points] of connectionGroups) {
        if (points.length < 2) continue
        graphics.lines!.push({
          points: points.map((p) => ({ x: p.x, y: p.y })),
          label: connectionName,
          strokeColor: "gray",
          strokeWidth: this.traceWidth,
        })
      }
    }

    // Visualize completed routes
    for (const route of this.routes) {
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[route.connectionName],
      )

      for (const segment of mergedSegments) {
        graphics.lines!.push({
          points: segment.points,
          label: segment.connectionName,
          strokeColor:
            segment.z === 0
              ? segment.color
              : safeTransparentize(segment.color, 0.75),
          layer: `z${segment.z}`,
          strokeWidth: route.traceThickness,
          strokeDash: segment.z !== 0 ? "10, 5" : undefined,
        })
      }

      // Add points with labels for each route point
      const routePoints = route.route
      for (let i = 0; i < routePoints.length; i++) {
        const pt = routePoints[i]
        const isStart = i === 0
        const isEnd = i === routePoints.length - 1
        const isMovable = !isStart && !isEnd
        let label: string
        if (isStart) {
          label = "start"
        } else if (isEnd) {
          label = "end"
        } else {
          label = `M${i}`
        }
        graphics.points!.push({
          x: pt.x,
          y: pt.y,
          label,
          color: isMovable ? "orange" : "blue",
        })
      }
    }

    // Visualize routes in progress (during force-directed solving)
    for (const routeInProgress of this.routesInProgress) {
      const { startPoint, endPoint, movablePoints, connectionName } =
        routeInProgress
      const color = this.colorMap[connectionName] ?? "gray"

      // Build line points in correct order
      const linePoints: Array<{ x: number; y: number }> = [
        { x: startPoint.x, y: startPoint.y },
      ]

      if (movablePoints.length === 1) {
        linePoints.push({ x: movablePoints[0].x, y: movablePoints[0].y })
      } else if (movablePoints.length === 2) {
        linePoints.push({ x: movablePoints[0].x, y: movablePoints[0].y })
        linePoints.push({ x: movablePoints[1].x, y: movablePoints[1].y })
      } else if (movablePoints.length === 3) {
        linePoints.push({ x: movablePoints[0].x, y: movablePoints[0].y })
        linePoints.push({ x: movablePoints[2].x, y: movablePoints[2].y }) // center
        linePoints.push({ x: movablePoints[1].x, y: movablePoints[1].y })
      }

      linePoints.push({ x: endPoint.x, y: endPoint.y })

      graphics.lines!.push({
        points: linePoints,
        label: connectionName,
        strokeColor: color,
        strokeWidth: this.traceWidth,
      })

      // Add labeled points
      graphics.points!.push({
        x: startPoint.x,
        y: startPoint.y,
        label: "start",
        color: "blue",
      })
      for (let i = 0; i < movablePoints.length; i++) {
        const mp = movablePoints[i]
        graphics.points!.push({
          x: mp.x,
          y: mp.y,
          label: `M${i + 1}`,
          color: "orange",
        })

        // Draw force vectors
        if (mp.forceX !== undefined && mp.forceY !== undefined) {
          const forceMagnitude = Math.sqrt(
            mp.forceX * mp.forceX + mp.forceY * mp.forceY,
          )
          if (forceMagnitude > 0.001) {
            // Scale force for visibility (multiply by a factor to make vectors visible)
            const scale = 5
            graphics.lines!.push({
              points: [
                { x: mp.x, y: mp.y },
                { x: mp.x + mp.forceX * scale, y: mp.y + mp.forceY * scale },
              ],
              strokeColor: "red",
              strokeWidth: 0.02,
              label: `F${i + 1}`,
            })
            // Draw arrowhead
            const arrowSize = 0.05
            const endX = mp.x + mp.forceX * scale
            const endY = mp.y + mp.forceY * scale
            const angle = Math.atan2(mp.forceY, mp.forceX)
            graphics.lines!.push({
              points: [
                { x: endX, y: endY },
                {
                  x: endX - arrowSize * Math.cos(angle - Math.PI / 6),
                  y: endY - arrowSize * Math.sin(angle - Math.PI / 6),
                },
              ],
              strokeColor: "red",
              strokeWidth: 0.02,
            })
            graphics.lines!.push({
              points: [
                { x: endX, y: endY },
                {
                  x: endX - arrowSize * Math.cos(angle + Math.PI / 6),
                  y: endY - arrowSize * Math.sin(angle + Math.PI / 6),
                },
              ],
              strokeColor: "purple",
              strokeWidth: 0.02,
            })
          }
        }
      }
      graphics.points!.push({
        x: endPoint.x,
        y: endPoint.y,
        label: "end",
        color: "blue",
      })
    }

    return graphics
  }
}
