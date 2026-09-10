import type {
  AutoroutingDiagnostic,
  ConnectionPoint,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"

function isPointInsidePolygon(
  point: { x: number; y: number },
  vs: Array<{ x: number; y: number }>,
): boolean {
  let inside = false
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i]!.x
    const yi = vs[i]!.y
    const xj = vs[j]!.x
    const yj = vs[j]!.y
    const intersect =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

export function isValidLayerName(layer: string, layerCount: number): boolean {
  if (layer === "top" || layer === "layer1" || layer === "1") return true
  if (
    layer === "bottom" ||
    layer === `layer${layerCount}` ||
    layer === String(layerCount)
  )
    return true
  if (layer.startsWith("inner")) {
    const num = parseInt(layer.slice(5), 10)
    if (Number.isNaN(num)) return false
    return layerCount > 2 && num >= 1 && num <= layerCount - 2
  }
  return false
}

function getConnectionPointLayers(p: ConnectionPoint): string[] {
  if ("layer" in p && typeof p.layer === "string") return [p.layer]
  if ("layers" in p && Array.isArray(p.layers)) return p.layers
  return []
}

/**
 * Runs fast, deterministic pre-routing validation checks on a SimpleRouteJson.
 * Emits actionable diagnostics for impossible geometry, invalid layers, or broken constraints.
 */
export function getPreRoutingDiagnostics(
  srj: SimpleRouteJson,
): AutoroutingDiagnostic[] {
  const diagnostics: AutoroutingDiagnostic[] = []
  const { bounds, outline, layerCount, connections, obstacles } = srj

  const connectionNameSet = new Set<string>()

  // 1. Connection-level checks
  for (const connection of connections ?? []) {
    connectionNameSet.add(connection.name)
    const points = connection.pointsToConnect ?? []

    if (points.length < 2) {
      diagnostics.push({
        code: "INSUFFICIENT_CONNECTION_POINTS",
        message: `Connection "${connection.name}" has fewer than 2 connection points (${points.length}).`,
        severity: "warning",
        recommendedAction: "continue",
        connectionNames: [connection.name],
      })
    }

    // Check each connection point
    for (const point of points) {
      const ptLayers = getConnectionPointLayers(point)

      // Check boundary: bounds
      const isOutsideBounds =
        bounds &&
        (point.x < bounds.minX ||
          point.x > bounds.maxX ||
          point.y < bounds.minY ||
          point.y > bounds.maxY)

      // Check boundary: outline polygon (if provided)
      const isOutsideOutline =
        outline && outline.length >= 3 && !isPointInsidePolygon(point, outline)

      if (isOutsideBounds || isOutsideOutline) {
        diagnostics.push({
          code: "CONNECTION_POINT_OUTSIDE_BOARD",
          message: `Connection "${connection.name}" has connection point at (${point.x}, ${point.y}) outside the board boundary.`,
          severity: "error",
          recommendedAction: "stop_and_fix",
          connectionNames: [connection.name],
          pcbPortIds: point.pcb_port_id ? [point.pcb_port_id] : undefined,
          locations: [
            {
              x: point.x,
              y: point.y,
              layer: ptLayers[0],
            },
          ],
        })
      }

      // Check layer validity
      for (const layer of ptLayers) {
        if (!isValidLayerName(layer, layerCount)) {
          diagnostics.push({
            code: "INVALID_ROUTING_LAYER",
            message: `Connection "${connection.name}" specifies layer "${layer}", which does not exist on this ${layerCount}-layer board.`,
            severity: "error",
            recommendedAction: "stop_and_fix",
            connectionNames: [connection.name],
            pcbPortIds: point.pcb_port_id ? [point.pcb_port_id] : undefined,
            locations: [{ x: point.x, y: point.y, layer }],
          })
        }
      }

      // Check if point is completely inside a foreign obstacle/keepout
      for (const obstacle of obstacles ?? []) {
        if (obstacle.connectedTo?.includes(connection.name)) continue
        if (obstacle.type === "rect") {
          const halfW = obstacle.width / 2
          const halfH = obstacle.height / 2
          const inside =
            point.x >= obstacle.center.x - halfW &&
            point.x <= obstacle.center.x + halfW &&
            point.y >= obstacle.center.y - halfH &&
            point.y <= obstacle.center.y + halfH

          if (inside && ptLayers.length > 0) {
            const allLayersBlocked = ptLayers.every((l) =>
              obstacle.layers.includes(l),
            )
            if (allLayersBlocked) {
              diagnostics.push({
                code: "TERMINAL_COMPLETELY_BLOCKED",
                message: `Connection "${connection.name}" terminal at (${point.x}, ${point.y}) is completely inside foreign obstacle "${obstacle.obstacleId ?? "unknown"}" on layer(s) ${ptLayers.join(", ")}.`,
                severity: "error",
                recommendedAction: "stop_and_fix",
                connectionNames: [connection.name],
                obstacleIds: obstacle.obstacleId
                  ? [obstacle.obstacleId]
                  : undefined,
                pcbPortIds: point.pcb_port_id ? [point.pcb_port_id] : undefined,
                locations: [{ x: point.x, y: point.y, layer: ptLayers[0] }],
              })
              break
            }
          }
        }
      }
    }

    // Check maxLength unreachable
    const maxLength =
      (connection as any).maxLength ?? (connection as any).max_length
    if (typeof maxLength === "number" && points.length >= 2) {
      // Check Euclidean distance between first two points
      const p1 = points[0]!
      const p2 = points[1]!
      const euclideanDist = Math.hypot(p2.x - p1.x, p2.y - p1.y)
      if (euclideanDist > maxLength) {
        diagnostics.push({
          code: "MAX_LENGTH_UNREACHABLE",
          message: `Connection "${connection.name}" has straight-line distance ${euclideanDist.toFixed(3)}mm exceeding maxLength ${maxLength.toFixed(3)}mm.`,
          severity: "error",
          recommendedAction: "stop_and_fix",
          connectionNames: [connection.name],
          locations: [
            { x: p1.x, y: p1.y, layer: getConnectionPointLayers(p1)[0] },
            { x: p2.x, y: p2.y, layer: getConnectionPointLayers(p2)[0] },
          ],
        })
      }
    }
  }

  // 2. Obstacle-level layer checks
  for (const obstacle of obstacles ?? []) {
    for (const layer of obstacle.layers ?? []) {
      if (!isValidLayerName(layer, layerCount)) {
        diagnostics.push({
          code: "INVALID_ROUTING_LAYER",
          message: `Obstacle "${obstacle.obstacleId ?? "unknown"}" specifies invalid layer "${layer}" for ${layerCount}-layer board.`,
          severity: "error",
          recommendedAction: "stop_and_fix",
          obstacleIds: obstacle.obstacleId ? [obstacle.obstacleId] : undefined,
          locations: [{ x: obstacle.center.x, y: obstacle.center.y, layer }],
        })
      }
    }
  }

  // 3. Differential Pair checks
  for (const dp of srj.differentialPairs ?? []) {
    if (!dp.connectionNames || dp.connectionNames.length !== 2) {
      diagnostics.push({
        code: "INVALID_DIFFERENTIAL_PAIR",
        message: `Differential pair must contain exactly 2 connection names, got ${dp.connectionNames?.length ?? 0}.`,
        severity: "error",
        recommendedAction: "stop_and_fix",
        connectionNames: dp.connectionNames,
      })
      continue
    }

    const [c1, c2] = dp.connectionNames
    if (c1 === c2) {
      diagnostics.push({
        code: "INVALID_DIFFERENTIAL_PAIR",
        message: `Differential pair cannot pair connection "${c1}" with itself.`,
        severity: "error",
        recommendedAction: "stop_and_fix",
        connectionNames: [c1],
      })
      continue
    }

    if (!connectionNameSet.has(c1)) {
      diagnostics.push({
        code: "INVALID_DIFFERENTIAL_PAIR",
        message: `Differential pair references non-existent connection "${c1}".`,
        severity: "error",
        recommendedAction: "stop_and_fix",
        connectionNames: [c1],
      })
    }
    if (!connectionNameSet.has(c2)) {
      diagnostics.push({
        code: "INVALID_DIFFERENTIAL_PAIR",
        message: `Differential pair references non-existent connection "${c2}".`,
        severity: "error",
        recommendedAction: "stop_and_fix",
        connectionNames: [c2],
      })
    }
  }

  return diagnostics
}
