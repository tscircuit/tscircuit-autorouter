import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "../../types/high-density-types"
import type { Obstacle } from "../../types"

type Params = {
  routes: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
}

const VIA_INSIDE_OBSTACLE_TOLERANCE = 1e-6

function pointInsideObstacle(point: { x: number; y: number }, obstacle: Obstacle): boolean {
  return (
    Math.abs(point.x - obstacle.center.x) <=
      obstacle.width / 2 + VIA_INSIDE_OBSTACLE_TOLERANCE &&
    Math.abs(point.y - obstacle.center.y) <=
      obstacle.height / 2 + VIA_INSIDE_OBSTACLE_TOLERANCE
  )
}

/**
 * Native marking from trace-simplification-solver at
 * 88556c5410212b8489da1689ba8c5361b209e711 (MIT). Only repeated same-net
 * eligibility is removed; ordered contacts, point math and metadata stay native.
 *
 * Copyright (c) 2025-2026 tscircuit
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export function markNativeThroughObstacleSegments({ routes, obstacles, connMap }: Params): HighDensityRoute[] {
  return routes.map((route) => {
    const eligibleObstacles: Obstacle[] = []
    let nextObstacleIndex = 0
    const findContact = (hasContact: (obstacle: Obstacle) => boolean): Obstacle | undefined => {
      for (const obstacle of eligibleObstacles) {
        if (hasContact(obstacle)) return obstacle
      }
      // Visit an unseen suffix only when the native ordered find/some would
      // reach it. A successful early contact never evaluates a later bad net.
      while (nextObstacleIndex < obstacles.length) {
        const obstacle = obstacles[nextObstacleIndex++]!
        if (!((obstacle.__zLayers?.length ?? obstacle.layers?.length ?? 0) > 1)) continue
        const sameNet = obstacle.connectedTo.some((connectedId) =>
          connectedId === route.connectionName ||
          connectedId === route.rootConnectionName ||
          connMap.areIdsConnected(route.connectionName, connectedId) ||
          (route.rootConnectionName !== undefined &&
            connMap.areIdsConnected(route.rootConnectionName, connectedId)),
        )
        if (!sameNet) continue
        eligibleObstacles.push(obstacle)
        if (hasContact(obstacle)) return obstacle
      }
      return undefined
    }
    return {
      ...route,
      route: route.route.map((point, index, points) => {
        const nextPoint = points[index + 1]
        const sameNetObstacle = nextPoint && point.z !== nextPoint.z && findContact((obstacle) =>
          pointInsideObstacle(point, obstacle) && pointInsideObstacle(nextPoint, obstacle),
        )
        if (sameNetObstacle) {
          return { ...point, toNextSegmentType: "through_obstacle" as const,
            ...(sameNetObstacle.circuitJsonMetadata ? {
              toNextSegmentCircuitJsonMetadata: sameNetObstacle.circuitJsonMetadata,
            } : {}),
          }
        }
        const finalizedPoint = { ...point }
        delete finalizedPoint.toNextSegmentType
        delete finalizedPoint.toNextSegmentCircuitJsonMetadata
        return finalizedPoint
      }),
      vias: route.vias.filter((via) => !findContact((obstacle) => pointInsideObstacle(via, obstacle))),
    }
  })
}
