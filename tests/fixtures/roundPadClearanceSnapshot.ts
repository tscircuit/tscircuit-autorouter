import { pointToBoxDistance } from "@tscircuit/math-utils"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { isPipeline9ObstacleConnectedToRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import {
  type Pipeline9RouteViaSpan,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { Obstacle } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import type { getRoundPadRegionalFixture } from "./roundPadRegionalFixture"

type RegionalInput = ReturnType<typeof getRoundPadRegionalFixture>["input"]
type ClearanceWitness = {
  pad: Obstacle
  via: Pipeline9RouteViaSpan
  route: HighDensityRoute
  accepted: boolean
  circularGap: number
  rectangleGap: number
}

export const getRoundPadClearanceWitness = ({
  input,
  routes,
  accepted,
}: {
  input: RegionalInput
  routes: HighDensityRoute[]
  accepted: boolean
}): ClearanceWitness | undefined => {
  for (const route of routes) {
    if (!input.movablePreloadedConnectionNames.has(route.connectionName)) {
      continue
    }
    for (const via of getPipeline9RouteCopperGeometry(route, input).viaSpans) {
      for (const pad of input.boardObstacles) {
        if (pad.shape !== "circle") continue
        if (
          isPipeline9ObstacleConnectedToRoute({
            obstacle: pad,
            route,
            connMap: input.connMap,
          })
        ) {
          continue
        }
        const layers =
          pad.__zLayers ??
          pad.zLayers ??
          pad.layers.map((layer) => mapLayerNameToZ(layer, input.layerCount))
        if (!layers.some((z) => z >= via.minZ && z <= via.maxZ)) continue
        const circularGap =
          Math.hypot(via.center.x - pad.center.x, via.center.y - pad.center.y) -
          pad.width / 2 -
          via.diameter / 2
        const rectangleGap =
          pointToBoxDistance(via.center, pad) - via.diameter / 2
        if (
          rectangleGap < input.viaToPadClearance &&
          circularGap >= input.viaToPadClearance
        ) {
          return { pad, via, route, accepted, circularGap, rectangleGap }
        }
      }
    }
  }
  return undefined
}

export const getRoundPadClearanceSnapshot = ({
  witness,
  minClearance,
  viaHoleDiameter,
}: {
  witness: ClearanceWitness
  minClearance: number
  viaHoleDiameter: number
}): string => {
  const { pad, via, accepted, circularGap, rectangleGap } = witness
  const color = accepted ? "#166534" : "#b91c1c"
  const measurementLabel = accepted ? "Circular pad" : "Bounding box"
  const measuredGap = accepted ? circularGap : rectangleGap
  const padRadius = pad.width / 2
  const viaRadius = via.diameter / 2
  const centerDistance = Math.hypot(
    via.center.x - pad.center.x,
    via.center.y - pad.center.y,
  )
  const padEdge = accepted
    ? {
        x:
          pad.center.x +
          ((via.center.x - pad.center.x) * padRadius) / centerDistance,
        y:
          pad.center.y +
          ((via.center.y - pad.center.y) * padRadius) / centerDistance,
      }
    : {
        x: Math.max(
          pad.center.x - padRadius,
          Math.min(pad.center.x + padRadius, via.center.x),
        ),
        y: Math.max(
          pad.center.y - padRadius,
          Math.min(pad.center.y + padRadius, via.center.y),
        ),
      }
  const measuredDistance = Math.hypot(
    via.center.x - padEdge.x,
    via.center.y - padEdge.y,
  )
  const viaEdge = {
    x:
      via.center.x -
      ((via.center.x - padEdge.x) * viaRadius) / measuredDistance,
    y:
      via.center.y -
      ((via.center.y - padEdge.y) * viaRadius) / measuredDistance,
  }
  const fontSize = pad.width / 7
  const minX = pad.center.x - padRadius
  const maxY = via.center.y + viaRadius
  return getSvgFromGraphicsObject(
    {
      circles: [
        {
          center: pad.center,
          radius: padRadius,
          fill: "#fca5a5",
          stroke: "#b91c1c",
        },
        {
          center: via.center,
          radius: viaRadius,
          fill: "#93c5fd",
          stroke: "#1d4ed8",
        },
        {
          center: via.center,
          radius: viaHoleDiameter / 2,
          fill: "white",
          stroke: "#1d4ed8",
        },
      ],
      lines: [
        {
          points: [
            { x: pad.center.x - padRadius, y: pad.center.y - padRadius },
            { x: pad.center.x + padRadius, y: pad.center.y - padRadius },
            { x: pad.center.x + padRadius, y: pad.center.y + padRadius },
            { x: pad.center.x - padRadius, y: pad.center.y + padRadius },
            { x: pad.center.x - padRadius, y: pad.center.y - padRadius },
          ],
          strokeColor: "#64748b",
          strokeWidth: pad.width / 100,
          strokeDash: [pad.width / 30, pad.width / 30],
        },
        {
          points: [padEdge, viaEdge],
          strokeColor: color,
          strokeWidth: pad.width / 70,
        },
      ],
      texts: [
        {
          x: minX,
          y: maxY + fontSize * 4,
          text: accepted ? "Accepted" : "Rejected",
          color,
          fontSize,
          anchorSide: "center_left",
        },
        {
          x: minX,
          y: maxY + fontSize * 2.5,
          text: `${measurementLabel} gap: ${measuredGap.toFixed(3)} mm`,
          color,
          fontSize,
          anchorSide: "center_left",
        },
        {
          x: minX,
          y: pad.center.y - padRadius - fontSize * 2,
          text: `Actual gap: ${circularGap.toFixed(3)} mm`,
          color: "#334155",
          fontSize,
          anchorSide: "center_left",
        },
        {
          x: minX,
          y: pad.center.y - padRadius - fontSize * 3.5,
          text: `Required: ${minClearance.toFixed(3)} mm`,
          color: "#334155",
          fontSize,
          anchorSide: "center_left",
        },
      ],
    },
    { backgroundColor: "white", svgWidth: 800, svgHeight: 600 },
  )
}
