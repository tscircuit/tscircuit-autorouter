import { Circle, Line, Point, Rect } from "graphics-debug"
import { getColorMap, safeTransparentize } from "lib/solvers/colors"
import { SimpleRouteJson } from "lib/types"
import { getConnectionPointLayers } from "lib/types/srj-types"
import { createObstacleLabelFormatter } from "lib/utils/formatObstacleLabel"
import {
  getGraphicsLayerForConnectionPoint,
  getGraphicsLayerForObstacle,
  getGraphicsLayerFromLayerNames,
  getGraphicsZLayersForObstacle,
} from "lib/utils/getGraphicsObjectLayer"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { JUMPER_DIMENSIONS } from "lib/utils/jumperSizes"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { type LayerName, mapZToLayerName } from "lib/utils/mapZToLayerName"

const GRAPHICS_LAYER_COLORS = {
  top: "red",
  bottom: "blue",
  inner1: "green",
  inner2: "yellow",
  inner3: "orange",
  inner4: "purple",
  inner5: "cyan",
  inner6: "magenta",
  inner7: "lime",
  inner8: "brown",
} satisfies Record<LayerName, string>

const NEUTRAL_OBSTACLE_COLOR = "gray"

export type TraceColorMode = "layer" | "net"

export type ConvertSrjToGraphicsObjectOptions = {
  traceColorMode?: TraceColorMode
}

function getGraphicsLayerColor(layerName: string): string {
  if (!Object.hasOwn(GRAPHICS_LAYER_COLORS, layerName)) {
    throw new Error(`No visualization color for layer "${layerName}"`)
  }

  return GRAPHICS_LAYER_COLORS[layerName as LayerName]
}

export const convertSrjToGraphicsObject = (
  srj: SimpleRouteJson,
  options: ConvertSrjToGraphicsObjectOptions = {},
) => {
  const lines: Line[] = []
  const circles: Circle[] = []
  const points: Point[] = []
  const rects: Rect[] = []

  const colorMap: Record<string, string> = getColorMap(srj)
  const traceColorMode = options.traceColorMode ?? "layer"
  const layerCount = srj.layerCount
  const viaDimensions = getViaDimensions(srj)
  const formatObstacleLabel = createObstacleLabelFormatter(srj)

  // Add points for each connection's pointsToConnect
  if (srj.connections) {
    for (const connection of srj.connections) {
      for (const point of connection.pointsToConnect) {
        const pointLayers = getConnectionPointLayers(point)
        const rootConnectionNames = connection.__rootConnectionNames ?? [
          connection.name,
        ]
        points.push({
          x: point.x,
          y: point.y,
          color: colorMap[connection.name]!,
          layer: getGraphicsLayerForConnectionPoint(point, layerCount),
          label: [
            connection.name,
            rootConnectionNames.join(", "),
            pointLayers.join(","),
          ].join("\n"),
        })
      }
    }
  }

  // Process each trace
  if (srj.traces) {
    for (const trace of srj.traces) {
      let traceWidth = srj.minTraceWidth

      // Extract jumpers from this trace's route to identify wire segments that should be skipped
      const jumpers = trace.route.filter(
        (r): r is Extract<typeof r, { route_type: "jumper" }> =>
          r.route_type === "jumper",
      )

      // Helper to check if a wire segment is inside a jumper (connects jumper start to end)
      const isWireSegmentInsideJumper = (
        p1: { x: number; y: number },
        p2: { x: number; y: number },
      ): boolean => {
        const tolerance = 0.01
        for (const jumper of jumpers) {
          // Check if this segment connects the jumper's start and end points
          const matchesForward =
            Math.abs(p1.x - jumper.start.x) < tolerance &&
            Math.abs(p1.y - jumper.start.y) < tolerance &&
            Math.abs(p2.x - jumper.end.x) < tolerance &&
            Math.abs(p2.y - jumper.end.y) < tolerance

          const matchesBackward =
            Math.abs(p1.x - jumper.end.x) < tolerance &&
            Math.abs(p1.y - jumper.end.y) < tolerance &&
            Math.abs(p2.x - jumper.start.x) < tolerance &&
            Math.abs(p2.y - jumper.start.y) < tolerance

          if (matchesForward || matchesBackward) {
            return true
          }
        }
        return false
      }

      for (const routePoint of trace.route) {
        if (routePoint.route_type === "via") {
          const fromZ = mapLayerNameToZ(routePoint.from_layer, layerCount)
          const toZ = mapLayerNameToZ(routePoint.to_layer, layerCount)
          const viaRadius =
            (routePoint.via_diameter ?? viaDimensions.padDiameter) / 2
          const zLayers = Array.from(
            { length: Math.abs(toZ - fromZ) + 1 },
            (_, index) => Math.min(fromZ, toZ) + index,
          )

          circles.push({
            center: { x: routePoint.x, y: routePoint.y },
            radius: viaRadius,
            fill:
              traceColorMode === "net"
                ? colorMap[trace.connection_name]!
                : "blue",
            stroke: "none",
            layer: `z${zLayers.join(",")}`,
          })
        } else if (routePoint.route_type === "through_obstacle") {
          const connectionColor = colorMap[trace.connection_name] ?? "purple"
          lines.push({
            points: [routePoint.start, routePoint.end],
            strokeColor: safeTransparentize(connectionColor, 0.35),
            strokeWidth: routePoint.width,
            strokeDash: [0.1, 0.1],
            layer: getGraphicsLayerFromLayerNames(
              [routePoint.from_layer, routePoint.to_layer],
              layerCount,
            ),
            label: `${trace.connection_name} through_obstacle`,
          })
        }
      }

      for (let j = 0; j < trace.route.length - 1; j++) {
        const routePoint = trace.route[j]
        const nextRoutePoint = trace.route[j + 1]

        if (routePoint.route_type === "jumper") {
          // Draw jumper pads and body
          const color =
            colorMap[trace.connection_name] ?? "rgba(255, 165, 0, 0.8)"

          // Get dimensions based on footprint
          const footprint = routePoint.footprint
          const dims =
            JUMPER_DIMENSIONS[
              footprint === "1206x4_pair" ? "1206x4_pair" : "0603"
            ] ?? JUMPER_DIMENSIONS["0603"]

          // Determine orientation
          const dx = routePoint.end.x - routePoint.start.x
          const dy = routePoint.end.y - routePoint.start.y
          const isHorizontal = Math.abs(dx) > Math.abs(dy)
          const padWidth = isHorizontal ? dims.padLength : dims.padWidth
          const padHeight = isHorizontal ? dims.padWidth : dims.padLength

          // Draw start pad
          rects.push({
            center: routePoint.start,
            width: padWidth,
            height: padHeight,
            fill: safeTransparentize(color, 0.5),
            stroke: "rgba(0, 0, 0, 0.5)",
            layer: getGraphicsLayerFromLayerNames(
              [routePoint.layer],
              layerCount,
            ),
          })

          // Draw end pad
          rects.push({
            center: routePoint.end,
            width: padWidth,
            height: padHeight,
            fill: safeTransparentize(color, 0.5),
            stroke: "rgba(0, 0, 0, 0.5)",
            layer: getGraphicsLayerFromLayerNames(
              [routePoint.layer],
              layerCount,
            ),
          })

          // Draw jumper body line
          lines.push({
            points: [routePoint.start, routePoint.end],
            strokeColor: "rgba(100, 100, 100, 0.8)",
            strokeWidth: dims.padWidth * 0.3,
            layer: getGraphicsLayerFromLayerNames(
              [routePoint.layer],
              layerCount,
            ),
          })
        } else if (
          routePoint.route_type === "wire" &&
          nextRoutePoint.route_type === "wire" &&
          nextRoutePoint.layer === routePoint.layer
        ) {
          // Skip wire segments that are inside a jumper (these are handled by the jumper drawing)
          if (
            isWireSegmentInsideJumper(
              { x: routePoint.x, y: routePoint.y },
              { x: nextRoutePoint.x, y: nextRoutePoint.y },
            )
          ) {
            continue
          }

          traceWidth = routePoint.width
          const isTopLayer = routePoint.layer === "top"
          const baseColor =
            traceColorMode === "net"
              ? colorMap[trace.connection_name]!
              : getGraphicsLayerColor(routePoint.layer)

          // Create a line between consecutive wire segments on the same layer
          lines.push({
            points: [
              { x: routePoint.x, y: routePoint.y },
              { x: nextRoutePoint.x, y: nextRoutePoint.y },
            ],
            layer: `z${mapLayerNameToZ(routePoint.layer, layerCount)}`,
            strokeWidth: traceWidth,
            strokeColor: isTopLayer
              ? baseColor
              : safeTransparentize(baseColor, 0.5),
            ...(traceColorMode === "net"
              ? { label: trace.connection_name }
              : {}),
            // Use dashed line for non-top layers
            ...(isTopLayer ? {} : { strokeDash: [0.2, 0.2] }),
          })
        }
      }
    }
  }

  // Add obstacle rects
  for (const o of srj.obstacles) {
    if (o.isCopperPour) continue
    const obstacleZLayers = getGraphicsZLayersForObstacle(o, layerCount)
    if (obstacleZLayers.length === 0) {
      throw new Error(
        `Cannot visualize obstacle "${o.obstacleId ?? "unknown"}" without a valid layer: layers=${o.layers.join(",")}, __zLayers=${o.__zLayers?.join(",") ?? "unset"}, layerCount=${layerCount}`,
      )
    }

    const onlyLayerName =
      obstacleZLayers.length === 1
        ? mapZToLayerName(obstacleZLayers[0]!, layerCount)
        : null
    const obstacleColor =
      onlyLayerName === "top" || onlyLayerName === "bottom"
        ? getGraphicsLayerColor(onlyLayerName)
        : NEUTRAL_OBSTACLE_COLOR

    rects.push({
      center: o.center,
      width: o.width,
      height: o.height,
      ccwRotationDegrees: o.ccwRotationDegrees,
      fill: safeTransparentize(obstacleColor, 0.5),
      layer: getGraphicsLayerForObstacle(o, layerCount),
      label: formatObstacleLabel(o),
    })
  }

  // Add jumper component rects from srj.jumpers if present
  if (srj.jumpers) {
    for (const jumper of srj.jumpers) {
      for (const pad of jumper.pads) {
        rects.push({
          center: pad.center,
          width: pad.width,
          height: pad.height,
          ccwRotationDegrees: pad.ccwRotationDegrees,
          fill: "rgba(255, 165, 0, 0.3)",
          stroke: "rgba(255, 165, 0, 0.8)",
          layer: getGraphicsLayerForObstacle(pad, layerCount),
        })
      }
    }
  }

  return {
    rects,
    circles,
    lines,
    points,
  }
}
