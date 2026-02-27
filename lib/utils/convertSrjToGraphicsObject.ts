import { Circle, Line, Point, Rect } from "graphics-debug"
import { getColorMap, safeTransparentize } from "lib/solvers/colors"
import { SimpleRouteJson } from "lib/types"
import {
  getConnectionPointLayer,
  getConnectionPointLayers,
} from "lib/types/srj-types"
import { JUMPER_DIMENSIONS } from "lib/utils/jumperSizes"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

export const convertSrjToGraphicsObject = (srj: SimpleRouteJson) => {
  const lines: Line[] = []
  const circles: Circle[] = []
  const points: Point[] = []
  const rects: Rect[] = []

  const colorMap: Record<string, string> = getColorMap(srj)
  const layerCount = 2
  const viaRadius = (srj.minViaDiameter ?? 0.3) / 2

  // Add points for each connection's pointsToConnect
  if (srj.connections) {
    for (const connection of srj.connections) {
      for (const point of connection.pointsToConnect) {
        const pointLayers = getConnectionPointLayers(point)
        points.push({
          x: point.x,
          y: point.y,
          color: colorMap[connection.name]!,
          layer:
            pointLayers[0] ??
            ("z" in point
              ? mapZToLayerName(point.z as number, layerCount)
              : "top"),
          label: `${connection.name} (${pointLayers.join(",")})`,
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

      for (let j = 0; j < trace.route.length - 1; j++) {
        const routePoint = trace.route[j]
        const nextRoutePoint = trace.route[j + 1]

        if (routePoint.route_type === "via") {
          // Add a circle for the via
          circles.push({
            center: { x: routePoint.x, y: routePoint.y },
            radius: viaRadius,
            fill: "blue",
            stroke: "none",
            layer: "z0,1",
          })
        } else if (routePoint.route_type === "jumper") {
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
            layer: "jumper",
          })

          // Draw end pad
          rects.push({
            center: routePoint.end,
            width: padWidth,
            height: padHeight,
            fill: safeTransparentize(color, 0.5),
            stroke: "rgba(0, 0, 0, 0.5)",
            layer: "jumper",
          })

          // Draw jumper body line
          lines.push({
            points: [routePoint.start, routePoint.end],
            strokeColor: "rgba(100, 100, 100, 0.8)",
            strokeWidth: dims.padWidth * 0.3,
            layer: "jumper-body",
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
          // Get the connection color, fallback to layer-based color
          const connectionColor = colorMap[trace.connection_name]
          const isTopLayer = routePoint.layer === "top"
          const baseColor =
            connectionColor ??
            {
              top: "red",
              bottom: "blue",
              inner1: "green",
              inner2: "yellow",
            }[routePoint.layer]!

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
            // Use dashed line for non-top layers
            ...(isTopLayer ? {} : { strokeDash: "3 2" }),
          })
        }
      }
    }
  }

  // Add obstacle rects
  for (const o of srj.obstacles) {
    rects.push({
      center: o.center,
      width: o.width,
      height: o.height,
      fill: "rgba(255,0,0,0.5)",
      layer: `z${o.layers.map((l) => mapLayerNameToZ(l, layerCount)).join(",")}`,
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
          fill: "rgba(255, 165, 0, 0.3)",
          stroke: "rgba(255, 165, 0, 0.8)",
          layer: "jumper",
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
