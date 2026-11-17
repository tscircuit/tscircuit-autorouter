import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { NetId, RootConnectionName, SimpleRouteJson } from "lib/types"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type H616SnapshotInput = {
  circuitJson: AnyCircuitElement[]
  srj: SimpleRouteJson
  connMap: ConnectivityMap
  node: NodeWithPortPoints
  routes: HighDensityRoute[]
  crossing: PortPoint
  clearanceMm: number
}

/** Show the native board and the regional replay without claiming a board solve. */
export function getH616PowerCrossingSnapshots({
  circuitJson,
  srj,
  connMap,
  node,
  routes,
  crossing,
  clearanceMm,
}: H616SnapshotInput): { board: string; crossing: string } {
  const minimumClearanceMm = srj.minTraceToPadEdgeClearance
  if (minimumClearanceMm === undefined) {
    throw new Error("The H616 crossing fixture requires declared clearance")
  }
  const nativeNetByRoot = new Map<RootConnectionName, NetId>(
    srj.connections.map((connection) => [
      connMap.getNetConnectedToId(connection.name) ?? connection.name,
      connection.name,
    ]),
  )
  const regionalCopper = routes.map((route, index): AnyCircuitElement => {
    if (route.route.some((point) => point.z !== crossing.z)) {
      throw new Error("The H616 crossing replay must remain on one layer")
    }
    const root =
      connMap.getNetConnectedToId(route.connectionName) ??
      route.rootConnectionName
    const nativeNet = root === undefined ? undefined : nativeNetByRoot.get(root)
    if (!nativeNet) throw new Error("Missing native owner for regional copper")
    return {
      type: "pcb_trace",
      pcb_trace_id: `h616_power_region_${index}`,
      source_trace_id: nativeNet,
      route: route.route.map((point) => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: route.traceThickness,
        layer: mapZToLayerName(point.z, srj.layerCount),
      })),
    }
  })
  const minX = node.center.x - node.width / 2
  const maxX = node.center.x + node.width / 2
  const minY = node.center.y - node.height / 2
  const maxY = node.center.y + node.height / 2
  const cpuSource = circuitJson.find(
    (element) => element.type === "source_component" && element.name === "U1",
  )
  if (cpuSource?.type !== "source_component") {
    throw new Error("Missing native H616 CPU")
  }
  const cpu = circuitJson.find(
    (element) =>
      element.type === "pcb_component" &&
      element.source_component_id === cpuSource.source_component_id,
  )
  if (cpu?.type !== "pcb_component") {
    throw new Error("Missing native H616 PCB component")
  }
  const markerRadius = srj.minTraceWidth
  const annotations: AnyCircuitElement[] = [
    {
      type: "pcb_silkscreen_path",
      pcb_silkscreen_path_id: "routing_window",
      pcb_component_id: cpu.pcb_component_id,
      layer: "top",
      stroke_width: srj.minTraceWidth / 4,
      route: [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
        { x: minX, y: minY },
      ],
    },
    ...[-1, 1].map(
      (direction): AnyCircuitElement => ({
        type: "pcb_silkscreen_path",
        pcb_silkscreen_path_id: `crossing_${direction}`,
        pcb_component_id: cpu.pcb_component_id,
        layer: "top",
        stroke_width: srj.minTraceWidth / 3,
        route: [
          {
            x: crossing.x - markerRadius,
            y: crossing.y - direction * markerRadius,
          },
          {
            x: crossing.x + markerRadius,
            y: crossing.y + direction * markerRadius,
          },
        ],
      }),
    ),
  ]
  const replayCircuit = [...circuitJson, ...regionalCopper, ...annotations]
  const renderOptions = {
    backgroundColor: "white",
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    renderSolderMask: false,
    colorOverrides: {
      copper: {
        top: "#dc2626",
        bottom: "#2563eb",
        inner1: "#16a34a",
        inner2: "#b45309",
      },
      drill: "#ffffff",
      boardOutline: "#466047",
      silkscreen: { top: "#1d4ed8", bottom: "#334155" },
      debugComponent: { stroke: "#64748b", fill: null },
    },
  }
  const pathCount = new Set(
    node.portPoints.map((point) => point.connectionName),
  ).size
  const summary = `H616 power-region replay: ${routes.length}/${pathCount} paths · Full board incomplete`
  const board = convertCircuitJsonToPcbSvg(replayCircuit, {
    ...renderOptions,
    width: 1000,
    height: 1900,
  }).replace(
    "</svg>",
    `<rect x="8" y="8" width="984" height="40" fill="white" stroke="#64748b"/><text x="20" y="35" font-family="Arial,sans-serif" font-size="18" fill="#1e293b">${summary}</text></svg>`,
  )
  const focusPaddingMm = Math.max(node.width, node.height) / 4
  const focusedCircuit = replayCircuit.map((element): AnyCircuitElement => {
    if (element.type !== "pcb_board") return element
    return {
      ...element,
      center: node.center,
      width: node.width + 2 * focusPaddingMm,
      height: node.height + 2 * focusPaddingMm,
      outline: undefined,
    }
  })
  const color = clearanceMm >= minimumClearanceMm ? "#166534" : "#b91c1c"
  const caption = `Ground crossing: ${clearanceMm.toFixed(3)} mm gap · Required: ${minimumClearanceMm.toFixed(3)} mm`
  const crossingSvg = convertCircuitJsonToPcbSvg(focusedCircuit, {
    ...renderOptions,
    width: 1000,
    height: 1200,
    drawPaddingOutsideBoard: false,
  }).replace(
    "</svg>",
    `<rect x="8" y="8" width="984" height="72" fill="white" stroke="${color}"/><text x="20" y="36" font-family="Arial,sans-serif" font-size="21" fill="${color}">${caption}</text><text x="20" y="64" font-family="Arial,sans-serif" font-size="17" fill="#1d4ed8">Blue cross: planned crossing · Blue box: routing window</text></svg>`,
  )
  return { board, crossing: crossingSvg }
}
