import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { DetectedComponent } from "lib/solvers/ComponentDetectionSolver/ComponentDetectionSolver"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { ConnectionPoint, Obstacle, SimpleRouteJson } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

type Terminal = {
  connection: SimpleRouteJson["connections"][number]
  point: ConnectionPoint
}

const GEOMETRY_EPSILON = 1e-9
const CLEARANCE_EPSILON = 1e-6

function getPositionKey(x: number, y: number): string {
  // This key only finds candidates. Exact geometry is checked before rejecting
  // a terminal, so coordinate rounding cannot create an infeasibility proof.
  // Nonmatching coordinates are left to the full router.
  return `${x.toFixed(6)}:${y.toFixed(6)}`
}

/**
 * A sufficient infeasibility check, not a general escape planner. Four equal
 * square pads at the cardinal points of a square grid enclose the terminal
 * when their trace-clearance expansions meet along the enclosing diamond.
 * Inside that diamond, the maximum distance to the nearest pad is bounded by
 * max(pitch - padSize / 2, (pitch - padSize) / sqrt(2)). If even a via cannot
 * fit there, neither a same-layer escape nor a layer transition is possible.
 */
export function getUnroutableBgaTerminalError(
  srj: SimpleRouteJson,
  components: DetectedComponent[],
  connMap: ConnectivityMap,
): string | null {
  const bgaIds = new Set(
    components
      .filter((component) => component.componentKind === "bga")
      .map((component) => component.componentId),
  )
  if (bgaIds.size === 0) return null

  // Existing copper, jumpers, and off-board connections can bypass the pocket.
  // Leave those cases to the routing stages, which understand their geometry.
  if (
    srj.traces?.length ||
    srj.jumpers?.length ||
    srj.allowJumpers ||
    srj.connections.some((connection) => connection.isOffBoard) ||
    srj.obstacles.some(
      (obstacle) =>
        obstacle.isCopperPour ||
        obstacle.netIsAssignable ||
        obstacle.offBoardConnectsTo?.length,
    )
  ) {
    return null
  }
  const padsByComponent = new Map<string, Obstacle[]>()
  for (const obstacle of srj.obstacles) {
    if (!obstacle.componentId || !bgaIds.has(obstacle.componentId)) continue
    const pads = padsByComponent.get(obstacle.componentId)
    if (pads) pads.push(obstacle)
    else padsByComponent.set(obstacle.componentId, [obstacle])
  }
  const terminalsByPosition = new Map<string, Terminal[]>()
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      const key = getPositionKey(point.x, point.y)
      const terminals = terminalsByPosition.get(key)
      if (terminals) terminals.push({ connection, point })
      else terminalsByPosition.set(key, [{ connection, point }])
    }
  }
  let obstaclesByNet: Map<string, Obstacle[]> | undefined
  const { padDiameter, holeDiameter } = getViaDimensions(srj)
  const traceClearance =
    srj.minTraceToPadEdgeClearance ?? RELAXED_DRC_OPTIONS.traceClearance ?? 0.1
  const viaClearance = Math.max(
    RELAXED_DRC_OPTIONS.viaClearance ?? 0.1,
    srj.defaultObstacleMargin ?? 0,
    srj.minViaEdgeToPadEdgeClearance ?? 0,
  )

  for (const [componentId, pads] of padsByComponent) {
    const padsByPosition = new Map(
      pads.map((pad) => [getPositionKey(pad.center.x, pad.center.y), pad]),
    )
    if (padsByPosition.size !== pads.length) continue
    const xs = pads.map((pad) => pad.center.x).sort((a, b) => a - b)
    let pitch = Number.POSITIVE_INFINITY
    for (let index = 1; index < xs.length; index++) {
      const gap = xs[index]! - xs[index - 1]!
      if (gap > GEOMETRY_EPSILON) pitch = Math.min(pitch, gap)
    }
    if (!Number.isFinite(pitch)) continue

    for (const pad of pads) {
      if (
        pad.layers.length !== 1 ||
        pad.shape ||
        pad.ccwRotationDegrees ||
        pad.isNonPlatedHole ||
        (pad.width + pad.height) / 2 >= pitch - CLEARANCE_EPSILON
      ) {
        continue
      }
      const { x, y } = pad.center
      const terminals = terminalsByPosition.get(getPositionKey(x, y))
      if (!terminals) continue
      const neighborCenters = [
        { x: x - pitch, y },
        { x: x + pitch, y },
        { x, y: y - pitch },
        { x, y: y + pitch },
      ]
      const neighbors: Obstacle[] = []
      for (const center of neighborCenters) {
        const neighbor = padsByPosition.get(
          getPositionKey(center.x, center.y),
        )
        if (
          neighbor &&
          !neighbor.shape &&
          !neighbor.ccwRotationDegrees &&
          !neighbor.isNonPlatedHole &&
          neighbor.layers.includes(pad.layers[0]!) &&
          Math.abs(neighbor.center.x - center.x) < GEOMETRY_EPSILON &&
          Math.abs(neighbor.center.y - center.y) < GEOMETRY_EPSILON
        ) {
          neighbors.push(neighbor)
        }
      }
      if (neighbors.length !== 4) continue
      const padSize = neighbors[0]!.width
      if (
        padSize <= 0 ||
        pitch <= padSize ||
        neighbors.some(
          (neighbor) =>
            Math.abs(neighbor.width - padSize) > GEOMETRY_EPSILON ||
            Math.abs(neighbor.height - padSize) > GEOMETRY_EPSILON,
        )
      ) {
        continue
      }
      const diagonalGap = Math.SQRT2 * (pitch - padSize)
      const maxViaCenterClearance = Math.max(
        pitch - padSize / 2,
        diagonalGap / 2,
      )
      if (
        padDiameter / 2 + viaClearance <=
        maxViaCenterClearance + CLEARANCE_EPSILON
      ) {
        continue
      }

      for (const { connection, point } of terminals) {
        const traceWidth = Math.min(
          srj.minTraceWidth,
          connection.nominalTraceWidth ??
            connection.width ??
            srj.minTraceWidth,
        )
        if (
          point.layer !== pad.layers[0] ||
          ("terminalVia" in point && point.terminalVia) ||
          Math.abs(point.x - x) > GEOMETRY_EPSILON ||
          Math.abs(point.y - y) > GEOMETRY_EPSILON ||
          diagonalGap + CLEARANCE_EPSILON >= traceWidth + 2 * traceClearance ||
          !pad.connectedTo.some((id) =>
            connMap.areIdsConnected(id, connection.name),
          ) ||
          neighbors.some((neighbor) =>
            neighbor.connectedTo.some((id) =>
              connMap.areIdsConnected(id, connection.name),
            ),
          ) ||
          !connection.pointsToConnect.some(
            (target) =>
              Math.abs(target.x - x) + Math.abs(target.y - y) >
              pitch + CLEARANCE_EPSILON,
          )
        ) {
          continue
        }
        // Same-net copper inside the pocket could provide an existing escape
        // or a plated transition. Index once, and only for a blocked candidate.
        if (!obstaclesByNet) {
          obstaclesByNet = new Map()
          for (const obstacle of srj.obstacles) {
            const connectedId = obstacle.connectedTo[0] ?? obstacle.obstacleId
            if (!connectedId) continue
            const net = connMap.getNetConnectedToId(connectedId)
            if (!net) continue
            const obstacles = obstaclesByNet.get(net)
            if (obstacles) obstacles.push(obstacle)
            else obstaclesByNet.set(net, [obstacle])
          }
        }
        const net = connMap.getNetConnectedToId(connection.name)
        const hasExistingEscape =
          net &&
          obstaclesByNet.get(net)?.some((obstacle): boolean => {
            const radius = Math.hypot(obstacle.width, obstacle.height) / 2
            return (
              obstacle !== pad &&
              obstacle.layers.includes(pad.layers[0]!) &&
              Math.abs(obstacle.center.x - x) <= pitch + radius &&
              Math.abs(obstacle.center.y - y) <= pitch + radius
            )
          })
        if (hasExistingEscape) continue

        const terminalId = point.pcb_port_id ?? point.pointId ?? `(${x}, ${y})`
        return (
          `Unroutable under these constraints: connection "${connection.name}" ` +
          `terminal "${terminalId}" in BGA "${componentId}" on ${point.layer} ` +
          `has no trace escape (${traceWidth.toFixed(3)} mm width, ` +
          `${traceClearance.toFixed(3)} mm pad clearance) and no legal via ` +
          `placement (${padDiameter.toFixed(3)} mm pad, ` +
          `${holeDiameter.toFixed(3)} mm hole, ` +
          `${viaClearance.toFixed(3)} mm pad clearance).`
        )
      }
    }
  }
  return null
}
