import type { GraphicsObject } from "graphics-debug"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

export function createConnectionRegionErrorVisualization(params: {
  srj: SimpleRouteJson
  baseSrj?: SimpleRouteJson
  error: unknown
}): GraphicsObject | null {
  const errorText: string =
    params.error instanceof Error ? params.error.message : String(params.error)
  const connectionRegionLookupErrorMatch: RegExpMatchArray | null =
    errorText.match(
      /Could not find (start|end) region for connection "([^\"]+)"/,
    )

  if (!connectionRegionLookupErrorMatch) {
    return null
  }

  const missingRegion: "start" | "end" =
    connectionRegionLookupErrorMatch[1] === "start" ? "start" : "end"
  const connectionName: string = connectionRegionLookupErrorMatch[2]!
  const failedConnection: SimpleRouteConnection | undefined =
    params.srj.connections.find(
      (connection) => connection.name === connectionName,
    ) ??
    params.srj.connections.find(
      (connection) => connection.rootConnectionName === connectionName,
    )
  const failedPoint =
    failedConnection?.pointsToConnect[missingRegion === "start" ? 0 : 1]

  if (!failedPoint) {
    return null
  }

  const markerRadius: number =
    params.srj.minTraceWidth * 6 > 0.75 ? params.srj.minTraceWidth * 6 : 0.75
  const markerHalfSize: number = markerRadius * 0.75

  const markerVisualization: GraphicsObject = {
    points: [
      {
        x: failedPoint.x,
        y: failedPoint.y,
        color: "red",
        layer: "pipeline_error_connection_point",
        label: [
          `Missing ${missingRegion} region`,
          connectionName,
          failedPoint.pcb_port_id ?? "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
    circles: [
      {
        center: { x: failedPoint.x, y: failedPoint.y },
        radius: markerRadius,
        fill: "rgba(255,0,0,0.12)",
        stroke: "red",
        layer: "pipeline_error_connection_point",
      },
    ],
    lines: [
      {
        points: [
          {
            x: failedPoint.x - markerHalfSize,
            y: failedPoint.y - markerHalfSize,
          },
          {
            x: failedPoint.x + markerHalfSize,
            y: failedPoint.y + markerHalfSize,
          },
        ],
        strokeColor: "red",
        strokeWidth:
          params.srj.minTraceWidth / 2 > 0.08
            ? params.srj.minTraceWidth / 2
            : 0.08,
        layer: "pipeline_error_connection_point",
        label: `Missing ${missingRegion} region\n${connectionName}`,
      },
      {
        points: [
          {
            x: failedPoint.x - markerHalfSize,
            y: failedPoint.y + markerHalfSize,
          },
          {
            x: failedPoint.x + markerHalfSize,
            y: failedPoint.y - markerHalfSize,
          },
        ],
        strokeColor: "red",
        strokeWidth:
          params.srj.minTraceWidth / 2 > 0.08
            ? params.srj.minTraceWidth / 2
            : 0.08,
        layer: "pipeline_error_connection_point",
      },
    ],
  }

  return combineVisualizations(
    convertSrjToGraphicsObject(params.baseSrj ?? params.srj),
    markerVisualization,
  )
}
