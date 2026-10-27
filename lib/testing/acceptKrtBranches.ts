import {
  checkCopperToBoardEdgeClearance,
  checkViasInPads,
} from "@tscircuit/checks"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { getConnectionPointLayers } from "lib/utils/connection-point-utils"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { z } from "zod"
import { evaluateRelaxedDrc } from "./evaluate-relaxed-drc"
import { MIN_VIA_TO_VIA_CLEARANCE } from "./getDrcErrors"
import { getOctilinearKrtTerminalConnector } from "./getOctilinearKrtTerminalConnector"
import type { KrtBranch } from "./prepareKrtBranches"

const wireSchema = z.object({
  route_type: z.literal("wire"),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive().finite(),
  layer: z.string(),
})
const viaSchema = z.object({
  route_type: z.literal("via"),
  x: z.number().finite(),
  y: z.number().finite(),
  from_layer: z.string(),
  to_layer: z.string(),
})
const tracesSchema = z.array(
  z.object({
    type: z.literal("pcb_trace"),
    pcb_trace_id: z.string(),
    connection_name: z.string(),
    route: z.array(z.discriminatedUnion("route_type", [wireSchema, viaSchema])),
  }),
)

/** Restore exact terminal geometry and original electrical identity, then check it. */
export const acceptKrtBranches = ({
  original,
  branches,
  proposed,
  gridStep,
}: {
  original: SimpleRouteJson
  branches: KrtBranch[]
  proposed: unknown
  gridStep: number
}): SimplifiedPcbTraces => {
  const parsed = tracesSchema.parse(proposed)
  const remaining = new Map(branches.map((branch) => [branch.name, branch]))
  const dimensions = getViaDimensions(original)
  const connectivity = getConnectivityMapFromSimpleRouteJson(original)
  const layers = new Set<string>(
    Array.from({ length: original.layerCount }, (_, index) =>
      mapZToLayerName(index, original.layerCount),
    ),
  )
  const traces: SimplifiedPcbTraces = []
  for (const trace of parsed) {
    const branch = remaining.get(trace.connection_name)
    if (!branch)
      throw new Error(`Unexpected KRT branch ${trace.connection_name}`)
    remaining.delete(trace.connection_name)
    if (
      trace.route.some((point) =>
        point.route_type === "wire"
          ? !layers.has(point.layer)
          : !layers.has(point.from_layer) || !layers.has(point.to_layer),
      )
    ) {
      throw new Error(
        `KRT used a layer outside the original board: ${branch.name}`,
      )
    }
    const first = trace.route[0]
    const last = trace.route.at(-1)
    if (
      trace.route.length < 1 ||
      first?.route_type !== "wire" ||
      last?.route_type !== "wire" ||
      !getConnectionPointLayers(branch.points[0]).includes(first.layer) ||
      !getConnectionPointLayers(branch.points[1]).includes(last.layer)
    ) {
      throw new Error(`Invalid KRT terminal layers for ${branch.name}`)
    }
    const endpoints = [first, last]
    const requestedWidth = Math.max(
      original.minTraceWidth,
      branch.connection.nominalTraceWidth ??
        branch.connection.width ??
        original.nominalTraceWidth ??
        original.minTraceWidth,
    )
    if (
      trace.route.some(
        (point) =>
          point.route_type === "wire" && point.width + 1e-9 < requestedWidth,
      )
    ) {
      throw new Error(`KRT did not preserve requested width for ${branch.name}`)
    }
    for (const [index, point] of trace.route.entries()) {
      const previous = trace.route[index - 1]
      const next = trace.route[index + 1]
      if (
        point.route_type === "via" &&
        (previous?.route_type !== "wire" ||
          next?.route_type !== "wire" ||
          previous.x !== point.x ||
          previous.y !== point.y ||
          next.x !== point.x ||
          next.y !== point.y ||
          previous.layer !== point.from_layer ||
          next.layer !== point.to_layer)
      ) {
        throw new Error(`Discontinuous KRT layer transition for ${branch.name}`)
      }
      if (
        point.route_type === "wire" &&
        previous?.route_type === "wire" &&
        point.layer !== previous.layer
      ) {
        throw new Error(`KRT wire changes layer without a via: ${branch.name}`)
      }
    }
    for (const [index, endpoint] of endpoints.entries()) {
      const terminal = branch.points[index]
      if (
        Math.abs(endpoint.x - terminal.x) > gridStep / 2 + 1e-9 ||
        Math.abs(endpoint.y - terminal.y) > gridStep / 2 + 1e-9
      ) {
        throw new Error(
          `KRT endpoint is not its terminal grid cell: ${branch.name}`,
        )
      }
    }
    // Keep the actual path and its layer transitions intact. Short axis/45deg
    // connectors undo nearest-cell rounding without introducing odd angles.
    const route = [
      ...getOctilinearKrtTerminalConnector({
        terminal: branch.points[0],
        gridPoint: first,
      }),
      ...trace.route,
      ...getOctilinearKrtTerminalConnector({
        terminal: branch.points[1],
        gridPoint: last,
      }).reverse(),
    ]
    traces.push({
      ...trace,
      pcb_trace_id: branch.name,
      connection_name: branch.connection.name,
      connectsTo: [
        branch.connection.name,
        ...(branch.connection.__rootConnectionNames ?? []),
        ...branch.points.flatMap((point) =>
          [point.pointId, point.pcb_port_id].filter(
            (id): id is string => typeof id === "string",
          ),
        ),
      ],
      route: route.map((point, index) =>
        point.route_type === "via"
          ? {
              ...point,
              via_diameter: dimensions.padDiameter,
              via_hole_diameter: dimensions.holeDiameter,
            }
          : {
              ...point,
              ...(index === 0 && branch.points[0].pcb_port_id
                ? { start_pcb_port_id: branch.points[0].pcb_port_id }
                : {}),
              ...(index === route.length - 1 && branch.points[1].pcb_port_id
                ? { end_pcb_port_id: branch.points[1].pcb_port_id }
                : {}),
            },
      ),
    })
  }
  if (remaining.size > 0) {
    throw new Error(`KRT omitted ${remaining.size} required terminal branches`)
  }

  // Independently check the backend's drill model against original dimensions,
  // including within one path. Coincident same-owner transitions describe one
  // physical through via when blind/buried vias are disabled.
  const vias = traces.flatMap((trace) =>
    trace.route
      .filter((point) => point.route_type === "via")
      .map((point) => ({ ...point, connectionName: trace.connection_name })),
  )
  const drillClearance = Math.max(
    MIN_VIA_TO_VIA_CLEARANCE,
    original.minViaHoleEdgeToViaHoleEdgeClearance ?? 0,
    original.minPlatedHoleDrillEdgeToDrillEdgeClearance ?? 0,
  )
  for (let a = 0; a < vias.length; a++) {
    for (let b = a + 1; b < vias.length; b++) {
      const distance = Math.hypot(vias[a].x - vias[b].x, vias[a].y - vias[b].y)
      if (
        vias[a].x === vias[b].x &&
        vias[a].y === vias[b].y &&
        !original.allowBlindAndBuriedVias &&
        (vias[a].connectionName === vias[b].connectionName ||
          connectivity.areIdsConnected(
            vias[a].connectionName,
            vias[b].connectionName,
          ))
      )
        continue
      if (distance + 1e-9 < dimensions.holeDiameter + drillClearance) {
        throw new Error(
          `KRT drill clearance violation between vias ${a} and ${b}`,
        )
      }
    }
  }

  const physical = evaluateRelaxedDrc({
    inputSrj: original,
    srjWithPointPairs: original,
    routedTraces: traces,
    includeBoardClearance: true,
    drcOptions: {
      traceClearance: original.defaultObstacleMargin ?? 0.1,
      includeTraceContinuity: true,
      includeTypedTraceClearance: true,
    },
  })
  const edgeErrors = checkCopperToBoardEdgeClearance(physical.circuitJson)
  const viaInPadErrors = original.allowViaInPad
    ? []
    : checkViasInPads(physical.circuitJson)
  if (physical.errors.length || edgeErrors.length || viaInPadErrors.length) {
    throw new Error(
      `KRT original-input acceptance failed: ${JSON.stringify({ errors: physical.errors, edgeErrors, viaInPadErrors })}`,
    )
  }
  return traces
}
