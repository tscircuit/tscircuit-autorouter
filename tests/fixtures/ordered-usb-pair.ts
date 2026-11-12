import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import captured from "./ordered-usb-pair.srj.json" with { type: "json" }

export const orderedUsbPair = captured as unknown as SimpleRouteJson
export const orderedUsbPipelines = [
  { number: 7, Pipeline: AutoroutingPipelineSolver7_MultiGraph },
  { number: 9, Pipeline: AutoroutingPipelineSolver9_PreloadedTraceGraph },
] as const

export function getOrderedUsbLaneLengths(
  routes: HighDensityRoute[],
  connections: SimpleRouteConnection[],
): {
  laneNames: string[][]
  pHops: number[]
  nHops: number[]
  p: number
  n: number
  tap: number
  skew: number
} {
  const laneNames = orderedUsbPair.differentialPairs![0]!.connectionNames.map(
    (name) => {
      const path = orderedUsbPair.connections.find((c) => c.name === name)!
        .path!
      return path
        .slice(1)
        .map(
          (to, index) =>
            connections.find((connection) =>
              [path[index], to].every((id) =>
                connection.pointsToConnect.some(
                  (point) => point.pointId === id,
                ),
              ),
            )!.name,
        )
    },
  )
  const lengthByName = new Map(
    routes.map((route) => [
      route.connectionName,
      route.route
        .slice(1)
        .reduce(
          (length, point, index) =>
            length +
            Math.hypot(
              point.x - route.route[index]!.x,
              point.y - route.route[index]!.y,
            ),
          0,
        ),
    ]),
  )
  const [pHops, nHops] = laneNames.map((names) =>
    names.map((name) => lengthByName.get(name)!),
  )
  const p = pHops!.reduce((a, b) => a + b, 0)
  const n = nHops!.reduce((a, b) => a + b, 0)
  const tap = routes
    .filter((route) => !laneNames.flat().includes(route.connectionName))
    .reduce(
      (total, route) => total + lengthByName.get(route.connectionName)!,
      0,
    )
  return {
    laneNames,
    pHops: pHops!,
    nHops: nHops!,
    p,
    n,
    tap,
    skew: Math.abs(p - n),
  }
}
