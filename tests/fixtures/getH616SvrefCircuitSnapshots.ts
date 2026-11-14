import type { AnyCircuitElement, SourceTrace } from "circuit-json"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import type { SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

export const getH616SvrefCircuitSnapshots = ({
  circuitJson,
  originalSrj,
  srjWithPointPairs,
  preloadedRoutes,
  hdRoutes,
  svrefTrace,
  regionalNode,
}: {
  circuitJson: AnyCircuitElement[]
  originalSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  preloadedRoutes: PreloadedHighDensityRoute[]
  hdRoutes: HighDensityRoute[]
  svrefTrace: SourceTrace
  regionalNode?: NodeWithPortPoints
}): { board: string; svref: string; srj: SimpleRouteJson } => {
  const preloadedNetByRoute = new Map(
    preloadedRoutes.map((route) => [
      route.connectionName,
      originalSrj.traces![route.preloadedTraceIndex]!.connection_name,
    ]),
  )
  // Render the accepted routing-stage segments, including updated DDR copper.
  // The complete board is not solved yet; no missing segments are filled in.
  const srj: SimpleRouteJson = {
    ...srjWithPointPairs,
    traces: [...preloadedRoutes, ...hdRoutes].map((route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_${index}`,
      connection_name:
        preloadedNetByRoute.get(route.connectionName) ?? route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, originalSrj.layerCount, {
        defaultViaHoleDiameter: originalSrj.minViaHoleDiameter,
      }),
    })),
  }
  const boardGraphics: GraphicsObject = convertSrjToGraphicsObject(srj)
  boardGraphics.points = []
  const ddrNetNames = new Set(
    originalSrj.traces!.map((trace) => trace.connection_name),
  )
  const sourcePortIds = new Set(svrefTrace.connected_source_port_ids)
  for (const element of circuitJson) {
    if (
      element.type === "source_trace" &&
      element.connected_source_net_ids?.some((netId) => ddrNetNames.has(netId))
    ) {
      for (const portId of element.connected_source_port_ids) {
        sourcePortIds.add(portId)
      }
    }
  }
  const componentIds = new Set(
    circuitJson
      .filter(
        (element) =>
          element.type === "source_port" &&
          sourcePortIds.has(element.source_port_id),
      )
      .map((element) => {
        if (element.type !== "source_port") throw new Error("Expected port")
        return element.source_component_id
      }),
  )
  const components = circuitJson.filter(
    (element) =>
      element.type === "pcb_component" &&
      componentIds.has(element.source_component_id),
  )
  const bounds = components.map((element) => {
    if (element.type !== "pcb_component") throw new Error("Expected component")
    return {
      minX: element.center.x - element.width / 2,
      maxX: element.center.x + element.width / 2,
      minY: element.center.y - element.height / 2,
      maxY: element.center.y + element.height / 2,
    }
  })
  const margin = 1
  const minX = Math.min(...bounds.map((bounds) => bounds.minX)) - margin
  const maxX = Math.max(...bounds.map((bounds) => bounds.maxX)) + margin
  const minY = Math.min(...bounds.map((bounds) => bounds.minY)) - margin
  const maxY = Math.max(...bounds.map((bounds) => bounds.maxY)) + margin
  const svrefNetId = svrefTrace.connected_source_net_ids![0]!
  const connectionNames = new Set(
    srj.connections
      .filter((connection) =>
        connection.__rootConnectionNames?.includes(svrefNetId),
      )
      .map((connection) => connection.name),
  )
  const ddrGraphics: GraphicsObject = convertSrjToGraphicsObject({
    ...srj,
    connections: [],
    obstacles: srj.obstacles.filter(
      (obstacle) =>
        obstacle.center.x + obstacle.width / 2 >= minX &&
        obstacle.center.x - obstacle.width / 2 <= maxX &&
        obstacle.center.y + obstacle.height / 2 >= minY &&
        obstacle.center.y - obstacle.height / 2 <= maxY,
    ),
    traces: srj.traces!.filter(
      (trace) =>
        ddrNetNames.has(trace.connection_name) ||
        connectionNames.has(trace.connection_name),
    ),
  })
  for (const component of components) {
    if (component.type !== "pcb_component")
      throw new Error("Expected component")
    const source = circuitJson.find(
      (element) =>
        element.type === "source_component" &&
        element.source_component_id === component.source_component_id,
    )!
    if (source.type !== "source_component") throw new Error("Missing component")
    if (!source.name.startsWith("U")) continue
    for (const graphics of [boardGraphics, ddrGraphics]) {
      graphics.rects!.push({
        center: component.center,
        width: component.width,
        height: component.height,
        fill: "transparent",
        stroke: "#475569",
      })
      graphics.texts ??= []
      graphics.texts.push({
        x: component.center.x,
        y: component.center.y + component.height / 2 + 0.6,
        text: `${source.name} ${source.manufacturer_part_number}`,
        fontSize: 0.5,
        color: "#334155",
        anchorSide: "bottom_center",
      })
    }
  }
  if (regionalNode) {
    for (const graphics of [boardGraphics, ddrGraphics]) {
      graphics.rects!.push({
        center: regionalNode.center,
        width: regionalNode.width,
        height: regionalNode.height,
        fill: "transparent",
        stroke: "#0f766e",
      })
      graphics.texts ??= []
      graphics.texts.push({
        x: regionalNode.center.x - regionalNode.width / 2,
        y: regionalNode.center.y + regionalNode.height / 2 + 0.25,
        text: "SVREF repair region",
        fontSize: 0.25,
        color: "#0f766e",
        anchorSide: "bottom_left",
      })
    }
  }
  const board = getSvgFromGraphicsObject(boardGraphics, {
    backgroundColor: "white",
    svgWidth: 1000,
    svgHeight: 2200,
  })
  const svref = getSvgFromGraphicsObject(ddrGraphics, {
    backgroundColor: "white",
    svgWidth: 1400,
    svgHeight: 1000,
  })
  return { board, svref, srj }
}
