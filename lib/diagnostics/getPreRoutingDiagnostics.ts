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
  if ("layer" in p && typeof (p as any).layer === "string")
    return [(p as any).layer]
  if ("layers" in p && Array.isArray((p as any).layers))
    return (p as any).layers
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

  // Calculate effective bounding box including obstacles and a 2mm tolerance
  // to avoid false positives for edge pads, connectors, or overhanging components.
  let effMinX = (bounds?.minX ?? 0) - 2
  let effMaxX = (bounds?.maxX ?? 0) + 2
  let effMinY = (bounds?.minY ?? 0) - 2
  let effMaxY = (bounds?.maxY ?? 0) + 2

  for (const obstacle of obstacles ?? []) {
    const halfW = (obstacle.width ?? 0) / 2
    const halfH = (obstacle.height ?? 0) / 2
    effMinX = Math.min(effMinX, obstacle.center.x - halfW - 2)
    effMaxX = Math.max(effMaxX, obstacle.center.x + halfW + 2)
    effMinY = Math.min(effMinY, obstacle.center.y - halfH - 2)
    effMaxY = Math.max(effMaxY, obstacle.center.y + halfH + 2)
  }

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

    const isOffBoard =
      (connection as any).isOffBoard === true ||
      (connection as any).offBoardConnectsTo?.length > 0

    // Check each connection point
    for (const point of points) {
      const ptLayers = getConnectionPointLayers(point)
      const isPointOffBoard = isOffBoard || (point as any).isOffBoard === true

      if (!isPointOffBoard) {
        let isOutside = false

        if (outline && outline.length >= 3) {
          isOutside = !isPointInsidePolygon(point, outline)
        } else if (bounds) {
          isOutside =
            point.x < effMinX ||
            point.x > effMaxX ||
            point.y < effMinY ||
            point.y > effMaxY
        }

        if (isOutside) {
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
      }

      // Check layer validity: connection point must have at least one valid layer
      if (
        ptLayers.length > 0 &&
        ptLayers.every((layer) => !isValidLayerName(layer, layerCount))
      ) {
        diagnostics.push({
          code: "INVALID_ROUTING_LAYER",
          message: `Connection "${connection.name}" specifies layer(s) "${ptLayers.join(", ")}", none of which exist on this ${layerCount}-layer board.`,
          severity: "error",
          recommendedAction: "stop_and_fix",
          connectionNames: [connection.name],
          pcbPortIds: point.pcb_port_id ? [point.pcb_port_id] : undefined,
          locations: [{ x: point.x, y: point.y, layer: ptLayers[0] }],
        })
      }

      // Check if point is inside a designated keepout
      for (const obstacle of obstacles ?? []) {
        const isKeepout =
          (obstacle as any).isKeepout === true ||
          (obstacle as any).is_keepout === true ||
          (obstacle as any).obstacleType === "keepout"

        if (!isKeepout) continue

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
              obstacle.layers?.includes(l),
            )
            if (allLayersBlocked) {
              diagnostics.push({
                code: "TERMINAL_BLOCKED_BY_KEEPOUT",
                message: `Connection "${connection.name}" terminal at (${point.x}, ${point.y}) is inside keepout "${obstacle.obstacleId ?? "unknown"}" on layer(s) ${ptLayers.join(", ")}.`,
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

  // 2. Obstacle-level layer checks: only flag if obstacle has NO valid layers on the board
  for (const obstacle of obstacles ?? []) {
    if (
      obstacle.layers &&
      obstacle.layers.length > 0 &&
      obstacle.layers.every((layer) => !isValidLayerName(layer, layerCount))
    ) {
      diagnostics.push({
        code: "INVALID_ROUTING_LAYER",
        message: `Obstacle "${obstacle.obstacleId ?? "unknown"}" specifies no valid layers for a ${layerCount}-layer board (layers: ${obstacle.layers.join(", ")}).`,
        severity: "error",
        recommendedAction: "stop_and_fix",
        obstacleIds: obstacle.obstacleId ? [obstacle.obstacleId] : undefined,
        locations: [
          {
            x: obstacle.center.x,
            y: obstacle.center.y,
            layer: obstacle.layers[0],
          },
        ],
      })
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
