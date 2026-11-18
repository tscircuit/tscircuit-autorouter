import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

export function getIcepiPlaneStitchSnapshotSvg({
  srj,
  hdRoutes,
}: {
  srj: SimpleRouteJson
  hdRoutes: HighDensityIntraNodeRoute[]
}): string {
  const traces = hdRoutes.map(
    (route, index): SimplifiedPcbTrace => ({
      type: "pcb_trace",
      pcb_trace_id: `plane-stitch-${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, srj.layerCount),
    }),
  )
  const graphics = convertSrjToGraphicsObject({ ...srj, traces })
  graphics.points = []
  const svg = getSvgFromGraphicsObject(graphics, {
    backgroundColor: "white",
    svgWidth: 1600,
    svgHeight: 1200,
  })
  const label = `iCE/Pi plane stitching: ${traces.length}/559 connections; before DRC repair`
  const overlay = `<g><rect x="12" y="12" width="1080" height="44" rx="6" fill="white" stroke="#334155"/><text x="24" y="40" font-family="Arial, sans-serif" font-size="20" fill="#334155">${label}</text></g>`
  return svg.replace("</svg>", `${overlay}</svg>`)
}
