import {
  segmentToBoxMinDistance,
  segmentToCircleMinDistance,
} from "@tscircuit/math-utils"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import type {
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import { RbushIndex } from "lib/data-structures/RbushIndex"

type TinyParams = ConstructorParameters<typeof TinyHyperGraphSolver>

/** Opt-in width-aware port eligibility, in board-world mm (+X right, +Y up, +Z above). */
export class MinimumTraceWidthTinyHyperGraphSolver extends TinyHyperGraphSolver {
  private readonly allowedPorts = new Map<number, Uint8Array>()
  private readonly obstacleIndex = new RbushIndex<
    Obstacle & { __zLayers: number[] }
  >()
  private readonly connMap: ReturnType<
    typeof getConnectivityMapFromSimpleRouteJson
  >

  constructor(
    topology: TinyParams[0],
    problem: TinyParams[1],
    options: TinyParams[2],
    private readonly srj: SimpleRouteJson,
  ) {
    super(topology, problem, {
      ...options,
      // Prepared and section-polishing solvers do not yet consult per-route
      // eligibility. Use native graph search throughout this opt-in solve.
      OWNED_REGIONAL_HOP_FRONTIER: false,
      GREEDY_FINAL_ROUTE_ITERS: 0,
      PARTIAL_RIP_ENABLED: false,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    })
    for (const obstacle of createObjectsWithZLayers(
      srj.obstacles,
      srj.layerCount,
    )) {
      const angle = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const cos = Math.abs(Math.cos(angle))
      const sin = Math.abs(Math.sin(angle))
      const halfWidth =
        obstacle.shape === "circle"
          ? obstacle.width / 2
          : (obstacle.width * cos + obstacle.height * sin) / 2
      const halfHeight =
        obstacle.shape === "circle"
          ? obstacle.width / 2
          : (obstacle.width * sin + obstacle.height * cos) / 2
      const clearance = obstacle.isNonPlatedHole
        ? (srj.minTraceToHoleEdgeClearance ??
          srj.minTraceToPadEdgeClearance ??
          0.15)
        : (srj.minTraceToPadEdgeClearance ?? 0.15)
      // Index the rotated physical envelope plus clearance. Exact shape,
      // layer and connectivity checks still run on every nearby obstacle.
      this.obstacleIndex.insert(
        obstacle,
        obstacle.center.x - halfWidth - clearance,
        obstacle.center.y - halfHeight - clearance,
        obstacle.center.x + halfWidth + clearance,
        obstacle.center.y + halfHeight + clearance,
      )
    }
    this.connMap = getConnectivityMapFromSimpleRouteJson(srj)
    for (let routeId = 0; routeId < problem.routeCount; routeId++) {
      const connection: SimpleRouteConnection | undefined =
        problem.routeMetadata?.[routeId]?.simpleRouteConnection
      if (
        connection?.minTraceWidth === undefined ||
        problem.routeIsFixed?.[routeId] === 1
      )
        continue
      if (!this.hasWidthCompliantPath(routeId)) {
        this.failed = true
        this.error = `Connection "${connection.name}" has no path for minimum trace width ${connection.minTraceWidth}mm`
        return
      }
    }
  }

  private isWidthCompliantPort(portId: number, routeId: number): boolean {
    const connection: SimpleRouteConnection | undefined =
      this.problem.routeMetadata?.[routeId]?.simpleRouteConnection
    if (connection?.minTraceWidth === undefined) return true
    let allowed = this.allowedPorts.get(routeId)
    if (!allowed) {
      allowed = new Uint8Array(this.topology.portCount)
      this.allowedPorts.set(routeId, allowed)
    }
    if (allowed[portId] !== 0) return allowed[portId] === 1
    const point = {
      x: this.topology.portX[portId]!,
      y: this.topology.portY[portId]!,
    }
    const z = this.topology.portZ[portId]!
    const radius =
      Math.max(this.srj.minTraceWidth, connection.minTraceWidth) / 2
    const edgeClearance = this.srj.minBoardEdgeClearance ?? 0
    let valid =
      point.x - radius >= this.srj.bounds.minX + edgeClearance - 1e-6 &&
      point.x + radius <= this.srj.bounds.maxX - edgeClearance + 1e-6 &&
      point.y - radius >= this.srj.bounds.minY + edgeClearance - 1e-6 &&
      point.y + radius <= this.srj.bounds.maxY - edgeClearance + 1e-6
    valid = valid && this.isWidthCompliantSegment(portId, portId, routeId)
    allowed[portId] = valid ? 1 : 2
    return valid
  }

  private hasWidthCompliantPath(routeId: number): boolean {
    const start = this.problem.routeStartPort[routeId]!
    const end = this.problem.routeEndPort[routeId]!
    if (
      !this.isWidthCompliantPort(start, routeId) ||
      !this.isWidthCompliantPort(end, routeId)
    )
      return false
    const visited = new Uint8Array(this.topology.portCount)
    const queue: number[] = [start]
    visited[start] = 1
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const portId = queue[cursor]!
      if (portId === end) return true
      for (const regionId of this.topology.incidentPortRegion[portId]!) {
        const net = this.problem.regionNetId[regionId]!
        if (net !== -1 && net !== this.problem.routeNet[routeId]) continue
        for (const nextPort of this.topology.regionIncidentPorts[regionId]!) {
          if (
            visited[nextPort] ||
            !this.isWidthCompliantPort(nextPort, routeId) ||
            !this.isWidthCompliantSegment(portId, nextPort, routeId)
          )
            continue
          visited[nextPort] = 1
          queue.push(nextPort)
        }
      }
    }
    return false
  }

  private isWidthCompliantSegment(
    from: number,
    to: number,
    routeId: number,
  ): boolean {
    const connection: SimpleRouteConnection | undefined =
      this.problem.routeMetadata?.[routeId]?.simpleRouteConnection
    if (connection?.minTraceWidth === undefined) return true
    const start = {
      x: this.topology.portX[from]!,
      y: this.topology.portY[from]!,
    }
    const end = { x: this.topology.portX[to]!, y: this.topology.portY[to]! }
    const startZ = this.topology.portZ[from]!
    const endZ = this.topology.portZ[to]!
    const radius =
      Math.max(this.srj.minTraceWidth, connection.minTraceWidth) / 2
    const obstacles = this.obstacleIndex.search(
      Math.min(start.x, end.x) - radius - 1e-6,
      Math.min(start.y, end.y) - radius - 1e-6,
      Math.max(start.x, end.x) + radius + 1e-6,
      Math.max(start.y, end.y) + radius + 1e-6,
    )
    for (const obstacle of obstacles) {
      if (
        !obstacle.__zLayers?.includes(startZ) &&
        !obstacle.__zLayers?.includes(endZ)
      )
        continue
      if (
        isObstacleConnectedToRoute(
          obstacle,
          {
            connectionName: connection.name,
            rootConnectionName: connection.rootConnectionName,
          },
          this.connMap,
        )
      )
        continue
      const clearance = obstacle.isNonPlatedHole
        ? (this.srj.minTraceToHoleEdgeClearance ??
          this.srj.minTraceToPadEdgeClearance ??
          0.15)
        : (this.srj.minTraceToPadEdgeClearance ?? 0.15)
      // Match TraceWidthSolver's board-to-pad frame for rotated copper.
      const angle = (-(obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const cos = Math.cos(angle),
        sin = Math.sin(angle)
      const localStart = {
        x:
          (start.x - obstacle.center.x) * cos -
          (start.y - obstacle.center.y) * sin,
        y:
          (start.x - obstacle.center.x) * sin +
          (start.y - obstacle.center.y) * cos,
      }
      const localEnd = {
        x:
          (end.x - obstacle.center.x) * cos - (end.y - obstacle.center.y) * sin,
        y:
          (end.x - obstacle.center.x) * sin + (end.y - obstacle.center.y) * cos,
      }
      const distance =
        obstacle.shape === "circle"
          ? segmentToCircleMinDistance(start, end, {
              ...obstacle.center,
              radius: obstacle.width / 2,
            })
          : segmentToBoxMinDistance(localStart, localEnd, {
              center: { x: 0, y: 0 },
              width: obstacle.width,
              height: obstacle.height,
            })
      if (distance + 1e-6 < radius + clearance) return false
    }
    return true
  }

  override computeG(
    ...args: Parameters<TinyHyperGraphSolver["computeG"]>
  ): number {
    const [candidate, neighbor] = args
    const routeId = this.state.currentRouteId
    if (
      routeId !== undefined &&
      !this.isWidthCompliantSegment(candidate.portId, neighbor, routeId)
    )
      return Infinity
    return super.computeG(...args)
  }

  override onPathFound(
    candidate: Parameters<TinyHyperGraphSolver["onPathFound"]>[0],
  ): void {
    const routeId = this.state.currentRouteId
    if (
      routeId !== undefined &&
      !this.isWidthCompliantSegment(
        candidate.portId,
        this.problem.routeEndPort[routeId]!,
        routeId,
      )
    )
      return
    super.onPathFound(candidate)
  }

  override isPortReservedForDifferentNet(portId: number): boolean {
    if (super.isPortReservedForDifferentNet(portId)) return true
    const routeId = this.state.currentRouteId
    return routeId !== undefined && !this.isWidthCompliantPort(portId, routeId)
  }
}
