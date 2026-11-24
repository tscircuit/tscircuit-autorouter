import { getPrimaryId } from "@tscircuit/circuit-json-util"
import {
  type Point,
  isPointInsidePolygon,
  pointToSegmentDistance,
} from "@tscircuit/math-utils"
import { all_layers } from "circuit-json"
import type {
  AnyCircuitElement,
  PcbPlatedHole,
  PcbPort,
  PcbSmtPad,
  PcbTrace,
} from "circuit-json"
import {
  ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import {
  getDrcReadablePortName,
  getDrcReadableTraceName,
} from "./drcReadableNames"
import {
  getPhysicalTraceConnectivity,
  type ViaContact,
  type WireSegment,
} from "./getPhysicalTraceConnectivity"

type Pad = PcbSmtPad | PcbPlatedHole
type RoutePoint = PcbTrace["route"][number]
type PadMap = Map<string, Pad[]>
type Wire = Extract<RoutePoint, { route_type: "wire" }>
/** Pad shapes produced by convertToCircuitJson, including their boundaries. */
const pointIsInPad = (point: Point, pad: Pad): boolean => {
  if (pad.shape === "circle") {
    const radius =
      pad.type === "pcb_smtpad" ? pad.radius : pad.outer_diameter / 2
    return Math.hypot(point.x - pad.x, point.y - pad.y) <= radius + 1e-9
  }
  if (pad.type === "pcb_smtpad" && pad.shape === "rect") {
    return (
      Math.abs(point.x - pad.x) <= pad.width / 2 + 1e-9 &&
      Math.abs(point.y - pad.y) <= pad.height / 2 + 1e-9
    )
  }
  let width: number
  let height: number
  let rotation: number
  if (pad.type === "pcb_smtpad" && pad.shape === "rotated_rect") {
    width = pad.width
    height = pad.height
    rotation = pad.ccw_rotation ?? 0
  } else if ("rect_pad_width" in pad && "rect_pad_height" in pad) {
    width = pad.rect_pad_width
    height = pad.rect_pad_height
    rotation =
      "rect_ccw_rotation" in pad && typeof pad.rect_ccw_rotation === "number"
        ? pad.rect_ccw_rotation
        : 0
  } else {
    throw new Error(
      `Unsupported autorouting continuity pad shape: ${pad.shape}`,
    )
  }
  const angle = (rotation * Math.PI) / 180
  const polygon = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map(({ x, y }) => ({
    x: pad.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: pad.y + x * Math.sin(angle) + y * Math.cos(angle),
  }))
  for (let index = 0; index < polygon.length; index++) {
    const start = polygon[index]!
    const end = polygon[(index + 1) % polygon.length]!
    const dx = end.x - start.x
    const dy = end.y - start.y
    const cross = (point.y - start.y) * dx - (point.x - start.x) * dy
    const dot = (point.x - start.x) * dx + (point.y - start.y) * dy
    if (
      Math.abs(cross) <= 1e-9 &&
      dot >= -1e-9 &&
      dot <= dx * dx + dy * dy + 1e-9
    ) {
      return true
    }
  }
  return isPointInsidePolygon(point, polygon)
}

const routePointReferencesPort = (
  point: RoutePoint,
  portId: string,
): boolean => {
  if (point.route_type !== "wire") return false
  return point.start_pcb_port_id === portId || point.end_pcb_port_id === portId
}

const routePointTouchesPad = (point: RoutePoint, pad: Pad): boolean => {
  if (point.route_type !== "wire") return false
  const layers = pad.type === "pcb_smtpad" ? [pad.layer] : pad.layers
  return layers.includes(point.layer) && pointIsInPad(point, pad)
}

const viaTouchesPad = (via: ViaContact, pad: Pad): boolean => {
  if (via.radius === undefined) return pointIsInPad(via, pad)
  if (pad.shape === "circle") {
    const radius =
      pad.type === "pcb_smtpad" ? pad.radius : pad.outer_diameter / 2
    return (
      Math.hypot(via.x - pad.x, via.y - pad.y) <= radius + via.radius + 1e-9
    )
  }
  const width =
    "rect_pad_width" in pad
      ? pad.rect_pad_width
      : "width" in pad
        ? pad.width
        : undefined
  const height =
    "rect_pad_height" in pad
      ? pad.rect_pad_height
      : "height" in pad
        ? pad.height
        : undefined
  if (
    width === undefined ||
    height === undefined ||
    !("x" in pad) ||
    !("y" in pad)
  ) {
    throw new Error(
      `Unsupported autorouting continuity pad shape: ${pad.shape}`,
    )
  }
  const rotation =
    "rect_ccw_rotation" in pad
      ? (pad.rect_ccw_rotation ?? 0)
      : "ccw_rotation" in pad
        ? (pad.ccw_rotation ?? 0)
        : 0
  const radians = (rotation * Math.PI) / 180
  const dx = via.x - pad.x
  const dy = via.y - pad.y
  const x = dx * Math.cos(radians) + dy * Math.sin(radians)
  const y = -dx * Math.sin(radians) + dy * Math.cos(radians)
  const gap = Math.hypot(
    Math.max(Math.abs(x) - width / 2, 0),
    Math.max(Math.abs(y) - height / 2, 0),
  )
  return gap <= via.radius + 1e-9
}

const getEndpointCopperWidth = (
  trace: PcbTrace,
  endpoint: "start" | "end",
): number | undefined => {
  if (trace.route_thickness_mode === "interpolated") return undefined
  let index = endpoint === "start" ? 0 : trace.route.length - 2
  const direction = endpoint === "start" ? 1 : -1
  while (index >= 0 && index < trace.route.length - 1) {
    const start = trace.route[index]!
    const end = trace.route[index + 1]!
    if (
      start.route_type !== "wire" ||
      end.route_type !== "wire" ||
      start.layer !== end.layer
    )
      return undefined
    if (Math.hypot(start.x - end.x, start.y - end.y) > 1e-9) return start.width
    index += direction
  }
  return undefined
}

const getMissingConnectionCenter = (
  first: RoutePoint,
  last: RoutePoint,
  port: PcbPort,
  expectedPorts: PcbPort[],
  padsByPort: PadMap,
): Point => {
  const endpoints = [first, last]
  for (const endpoint of endpoints) {
    if (
      endpoint.route_type === "wire" &&
      routePointReferencesPort(endpoint, port.pcb_port_id)
    ) {
      return { x: endpoint.x, y: endpoint.y }
    }
  }
  for (let index = 0; index < endpoints.length; index++) {
    const endpoint = endpoints[index]!
    const other = endpoints[1 - index]!
    if (endpoint.route_type !== "wire" || other.route_type !== "wire") continue
    if (
      expectedPorts.some(
        (expectedPort) =>
          expectedPort.pcb_port_id !== port.pcb_port_id &&
          padsByPort
            .get(expectedPort.pcb_port_id)
            ?.some((pad) => routePointTouchesPad(endpoint, pad)),
      )
    ) {
      return { x: other.x, y: other.y }
    }
  }
  if (first.route_type === "wire" && last.route_type === "wire") {
    const nearest =
      Math.hypot(first.x - port.x, first.y - port.y) <=
      Math.hypot(last.x - port.x, last.y - port.y)
        ? first
        : last
    return { x: nearest.x, y: nearest.y }
  }
  for (const endpoint of endpoints) {
    if (endpoint.route_type === "wire") return { x: endpoint.x, y: endpoint.y }
  }
  const centers = endpoints.map(
    (point): Point =>
      point.route_type === "through_pad"
        ? {
            x: (point.start.x + point.end.x) / 2,
            y: (point.start.y + point.end.y) / 2,
          }
        : { x: point.x, y: point.y },
  )
  return {
    x: (centers[0]!.x + centers[1]!.x) / 2,
    y: (centers[0]!.y + centers[1]!.y) / 2,
  }
}

/** For each emitted route, source connections identify its expected terminals.
 * Compare those requirements with copper contact on the PCB layers. */
export const checkTraceContinuity = (
  circuitJson: AnyCircuitElement[],
  routing?: {
    getViasConnectedByCopperPour?: (elements: AnyCircuitElement[]) => string[][]
    isDeclaredTerminal?: (connection: string, endpoint: Wire) => boolean
  },
): Record<string, unknown>[] => {
  const errors: Record<string, unknown>[] = []
  const ports = circuitJson.filter((element) => element.type === "pcb_port")
  const traces = circuitJson.filter((element) => element.type === "pcb_trace")
  const sourceTraces = circuitJson.filter(
    (element) => element.type === "source_trace",
  )
  const sourceTraceById = new Map(
    sourceTraces.map((trace) => [trace.source_trace_id, trace]),
  )
  const padsByPort: PadMap = new Map()
  const pads = [
    ...circuitJson.filter((element) => element.type === "pcb_smtpad"),
    ...circuitJson.filter((element) => element.type === "pcb_plated_hole"),
  ]
  for (const pad of pads) {
    if (!pad.pcb_port_id) continue
    const portPads = padsByPort.get(pad.pcb_port_id)
    if (portPads) portPads.push(pad)
    else padsByPort.set(pad.pcb_port_id, [pad])
  }
  const board = circuitJson.find((element) => element.type === "pcb_board")
  const stack: string[] = [
    "top",
    ...all_layers
      .filter((layer) => layer.startsWith("inner"))
      .slice(0, board ? Math.max(0, board.num_layers - 2) : undefined),
    ...(board?.num_layers === 1 ? [] : ["bottom"]),
  ]
  // Netlist IDs identify which copper an endpoint is meant to reach.
  // Only geometric contacts contribute edges to the physical map below.
  const desiredConnectivity = getFullConnectivityMapFromCircuitJson(
    circuitJson.filter((e) => e.type !== "pcb_trace" && e.type !== "pcb_via"),
  )
  const emittedVias = circuitJson.filter((e) => e.type === "pcb_via")
  const owners: string[][] = []
  for (const trace of traces) {
    if (trace.source_trace_id)
      owners.push([trace.pcb_trace_id, trace.source_trace_id])
  }
  for (const via of emittedVias) {
    const owner = via.source_net_id ?? via.source_trace_id ?? via.pcb_trace_id
    if (owner) owners.push([via.pcb_via_id, owner])
  }
  desiredConnectivity.addConnections(owners)
  const viaContacts: ViaContact[] = emittedVias
    .filter(
      (via) => Number.isFinite(via.outer_diameter) && via.outer_diameter > 0,
    )
    .map((via) => ({
      id: via.pcb_via_id,
      x: via.x,
      y: via.y,
      radius: via.outer_diameter / 2,
      layers: via.layers,
      ownerTraceId: via.pcb_trace_id,
    }))
  const routeViaContacts: string[][] = []
  const portBridges = [...viaContacts]
  const segments: WireSegment[] = []
  for (const trace of traces) {
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index]!
      const next = trace.route[index + 1]
      if (
        point.route_type === "wire" &&
        next?.route_type === "wire" &&
        point.layer === next.layer
      ) {
        segments.push({ trace, start: point, end: next })
      }
      if (point.route_type !== "via") continue
      const from = stack.indexOf(point.from_layer)
      const to = stack.indexOf(point.to_layer)
      if (from < 0 || to < 0) continue
      const diameter = point.outer_diameter
      if (
        diameter !== undefined &&
        (!Number.isFinite(diameter) || diameter <= 0)
      )
        continue
      const contact: ViaContact = {
        id: trace.pcb_trace_id,
        x: point.x,
        y: point.y,
        radius: diameter === undefined ? undefined : diameter / 2,
        layers: stack.slice(Math.min(from, to), Math.max(from, to) + 1),
        ownerTraceId: trace.pcb_trace_id,
      }
      const matchingVias = emittedVias.filter(
        (via) => Math.hypot(via.x - point.x, via.y - point.y) <= 1e-9,
      )
      if (matchingVias.length === 0) portBridges.push(contact)
      for (const via of matchingVias) {
        const layers: readonly string[] = via.layers
        if (
          via.outer_diameter > 0 &&
          layers.includes(point.from_layer) &&
          layers.includes(point.to_layer)
        ) {
          routeViaContacts.push([trace.pcb_trace_id, via.pcb_via_id])
        }
      }
      if (!matchingVias.length) viaContacts.push(contact)
    }
  }
  const portsById = new Map(ports.map((port) => [port.pcb_port_id, port]))
  const canReachPortLayer = (point: Wire, port: PcbPort): boolean => {
    const portPads = padsByPort.get(port.pcb_port_id)
    const layers = portPads?.length
      ? [
          ...new Set(
            portPads.flatMap((pad) =>
              pad.type === "pcb_smtpad" ? [pad.layer] : pad.layers,
            ),
          ),
        ]
      : port.layers
    if (layers.includes(point.layer)) return true
    return portBridges.some((via) => {
      if (
        !via.layers.includes(point.layer) ||
        !layers.some((layer) => via.layers.includes(layer))
      )
        return false
      const reach = via.radius === undefined ? 0 : via.radius + point.width / 2
      if (Math.hypot(point.x - via.x, point.y - via.y) > reach + 1e-9)
        return false
      if (!portPads?.length)
        return Math.hypot(port.x - via.x, port.y - via.y) <= 1e-9
      return portPads.some(
        (pad) =>
          (pad.type === "pcb_smtpad" ? [pad.layer] : pad.layers).some((layer) =>
            via.layers.includes(layer),
          ) && viaTouchesPad(via, pad),
      )
    })
  }
  for (const trace of traces) {
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type !== "wire") continue
      for (const portId of new Set([
        point.start_pcb_port_id,
        point.end_pcb_port_id,
      ])) {
        if (!portId) continue
        const port = portsById.get(portId)
        if (!port || canReachPortLayer(point, port)) continue
        const portPads = padsByPort.get(portId)
        const padLayers = portPads?.length
          ? [
              ...new Set(
                portPads.flatMap((pad) =>
                  pad.type === "pcb_smtpad" ? [pad.layer] : pad.layers,
                ),
              ),
            ]
          : port.layers
        errors.push({
          type: "pcb_trace_error",
          error_type: "pcb_trace_error",
          pcb_trace_error_id: `missing_layer_connection_${trace.pcb_trace_id}_${index}_${port.pcb_port_id}`,
          pcb_trace_id: trace.pcb_trace_id,
          source_trace_id: trace.source_trace_id ?? `!${trace.pcb_trace_id}`,
          pcb_port_ids: [port.pcb_port_id],
          pcb_component_ids: port.pcb_component_id
            ? [port.pcb_component_id]
            : [],
          center: { x: point.x, y: point.y },
          message: `Trace [${getDrcReadableTraceName(circuitJson, trace.pcb_trace_id)}] on ${point.layer} is missing a via connection to port [${getDrcReadablePortName(circuitJson, port.pcb_port_id)}] on ${padLayers.join(", ")}.`,
        })
      }
    }
  }
  // Pad IDs identify individual pieces of copper. One logical port can
  // have several pads, which can sit on separate copper islands.
  const touchedPadsByTrace = new Map(
    traces.map((trace) => [
      trace.pcb_trace_id,
      pads
        .filter((pad) =>
          [trace.route[0], trace.route.at(-1)].some(
            (p) => p && routePointTouchesPad(p, pad),
          ),
        )
        .map((pad) => getPrimaryId(pad)!),
    ]),
  )
  // Common case: the routes meet at an endpoint on one pad. Only build
  // the board-wide spatial index when this cheaper physical check is insufficient.
  const padContacts = new ConnectivityMap({})
  padContacts.addConnections(
    Array.from(touchedPadsByTrace, ([id, touched]) => [id, ...touched]),
  )
  let physicalConnectivity: ConnectivityMap | undefined
  const endpointTouchesCopper = (
    trace: PcbTrace,
    endpoint: "start" | "end",
  ): boolean => {
    const point = endpoint === "start" ? trace.route[0] : trace.route.at(-1)
    const width = getEndpointCopperWidth(trace, endpoint)
    if (point?.route_type !== "wire" || width === undefined) return false
    const net = desiredConnectivity.getNetConnectedToId(trace.pcb_trace_id)
    if (!net) return false
    const netSegments = segments.filter(
      (segment) =>
        segment.trace.route_thickness_mode !== "interpolated" &&
        desiredConnectivity.getNetConnectedToId(segment.trace.pcb_trace_id) ===
          net &&
        Math.hypot(
          segment.start.x - segment.end.x,
          segment.start.y - segment.end.y,
        ) > 1e-9,
    )
    if (
      netSegments.some(
        (segment) =>
          segment.trace.pcb_trace_id !== trace.pcb_trace_id &&
          segment.start.layer === point.layer &&
          pointToSegmentDistance(point, segment.start, segment.end) <=
            (width + segment.start.width) / 2 + 1e-9,
      )
    )
      return true
    if (!Number.isFinite(width) || width <= 0) return false
    return viaContacts.some((via) => {
      if (
        via.ownerTraceId === trace.pcb_trace_id ||
        !via.layers.includes(point.layer) ||
        desiredConnectivity.getNetConnectedToId(via.id) !== net
      )
        return false
      const viaReach = via.radius === undefined ? 0 : via.radius + width / 2
      if (Math.hypot(point.x - via.x, point.y - via.y) > viaReach + 1e-9)
        return false
      if (
        pads.some(
          (pad) =>
            desiredConnectivity.getNetConnectedToId(getPrimaryId(pad)!) ===
              net &&
            (pad.type === "pcb_smtpad" ? [pad.layer] : pad.layers).some(
              (layer) => via.layers.includes(layer),
            ) &&
            viaTouchesPad(via, pad),
        )
      )
        return true
      return netSegments.some(
        (segment) =>
          segment.trace.pcb_trace_id !== trace.pcb_trace_id &&
          via.layers.includes(segment.start.layer) &&
          Number.isFinite(segment.start.width) &&
          segment.start.width > 0 &&
          pointToSegmentDistance(via, segment.start, segment.end) <=
            (via.radius === undefined
              ? 0
              : via.radius + segment.start.width / 2) +
              1e-9,
      )
    })
  }
  const checkedSourceTraceIds = new Set<string>()
  for (const trace of traces) {
    if (trace.route.length === 0) continue
    const first = trace.route[0]!
    const last = trace.route.at(-1)!
    const sourceTrace = sourceTraceById.get(trace.source_trace_id!)
    const expectedPorts = sourceTrace
      ? ports.filter((port) =>
          sourceTrace.connected_source_port_ids?.includes(port.source_port_id),
        )
      : []
    let traceName: string | undefined
    const sourceTraceId =
      sourceTrace?.source_trace_id ||
      trace.source_trace_id ||
      `!${trace.pcb_trace_id}`
    const commonError = {
      type: "pcb_trace_error",
      error_type: "pcb_trace_error",
      source_trace_id: sourceTraceId,
      pcb_trace_id: trace.pcb_trace_id,
      pcb_component_ids: [],
    }
    for (let index = 1; index < trace.route.length - 1; index++) {
      const previous = trace.route[index - 1]!
      const current = trace.route[index]!
      const next = trace.route[index + 1]!
      if (
        current.route_type !== "via" ||
        previous.route_type !== "wire" ||
        next.route_type !== "wire"
      )
        continue
      const from = stack.indexOf(current.from_layer)
      const to = stack.indexOf(current.to_layer)
      const emitted = emittedVias.filter(
        (via) =>
          via.pcb_trace_id === trace.pcb_trace_id &&
          Math.abs(via.x - current.x) < 0.01 &&
          Math.abs(via.y - current.y) < 0.01,
      )
      const spans =
        emitted.length > 0
          ? emitted.map((via) => via.layers)
          : [stack.slice(Math.min(from, to), Math.max(from, to) + 1)]
      const incomingAtVia =
        Math.abs(previous.x - current.x) < 0.01 &&
        Math.abs(previous.y - current.y) < 0.01
      const outgoingAtVia =
        Math.abs(next.x - current.x) < 0.01 &&
        Math.abs(next.y - current.y) < 0.01
      if (
        from >= 0 &&
        to >= 0 &&
        stack.includes(previous.layer) &&
        stack.includes(next.layer) &&
        spans.some(
          (layers) =>
            layers.includes(previous.layer) && layers.includes(next.layer),
        ) &&
        (incomingAtVia || previous.layer === current.from_layer) &&
        (outgoingAtVia || next.layer === current.to_layer)
      )
        continue
      traceName ??= getDrcReadableTraceName(circuitJson, trace.pcb_trace_id)
      errors.push({
        ...commonError,
        message: `Via in trace [${traceName}] does not connect its adjacent wire layers at position {x: ${current.x}, y: ${current.y}}.`,
        pcb_trace_error_id: `misaligned_via_${trace.pcb_trace_id}_${index}`,
        pcb_port_ids: [],
      })
    }
    if (sourceTrace && expectedPorts.length > 0) {
      if (checkedSourceTraceIds.has(sourceTrace.source_trace_id)) continue
      checkedSourceTraceIds.add(sourceTrace.source_trace_id)
    }
    for (const port of expectedPorts) {
      const portPads = padsByPort.get(port.pcb_port_id)
      if (!portPads?.length) continue
      if (
        [first, last].some((point) =>
          portPads.some((pad) => routePointTouchesPad(point, pad)),
        )
      )
        continue
      if (
        portPads.some((pad) =>
          padContacts.areIdsConnected(trace.pcb_trace_id, getPrimaryId(pad)!),
        )
      )
        continue
      physicalConnectivity ??= getPhysicalTraceConnectivity({
        segments,
        vias: viaContacts,
        pads,
        touchedPadsByTrace,
        viaConnections: [
          ...routeViaContacts,
          ...(routing?.getViasConnectedByCopperPour?.(circuitJson) ?? []),
        ],
      })
      if (
        portPads.some((pad) =>
          physicalConnectivity!.areIdsConnected(
            trace.pcb_trace_id,
            getPrimaryId(pad)!,
          ),
        )
      )
        continue
      const portName = getDrcReadablePortName(circuitJson, port.pcb_port_id)
      traceName ??= getDrcReadableTraceName(circuitJson, trace.pcb_trace_id)
      errors.push({
        ...commonError,
        message: `Trace [${traceName}] is missing a connection to ${portPads[0]!.type === "pcb_smtpad" ? "SMD pad" : "through-hole pad"} ${portName}`,
        pcb_trace_error_id: `missing_connection_${trace.pcb_trace_id}_${port.pcb_port_id}`,
        center: getMissingConnectionCenter(
          first,
          last,
          port,
          expectedPorts,
          padsByPort,
        ),
        pcb_port_ids: [port.pcb_port_id],
      })
    }
    if (expectedPorts.length > 0) continue
    const firstConnected =
      pads.some(
        (pad) =>
          desiredConnectivity.areIdsConnected(
            trace.pcb_trace_id,
            getPrimaryId(pad)!,
          ) && routePointTouchesPad(first, pad),
      ) || endpointTouchesCopper(trace, "start")
    const sameEndpoints =
      first.route_type === "wire" &&
      last.route_type === "wire" &&
      first.layer === last.layer &&
      Math.hypot(first.x - last.x, first.y - last.y) <= 1e-9
    for (const [index, endpoint] of [first, last].entries()) {
      if (endpoint.route_type !== "wire") continue
      if (index === 1 && sameEndpoints && !firstConnected) continue
      if (routing?.isDeclaredTerminal?.(sourceTraceId, endpoint)) continue
      if (
        pads.some(
          (pad) =>
            desiredConnectivity.areIdsConnected(
              trace.pcb_trace_id,
              getPrimaryId(pad)!,
            ) && routePointTouchesPad(endpoint, pad),
        ) ||
        endpointTouchesCopper(trace, index === 0 ? "start" : "end")
      )
        continue
      traceName ??= getDrcReadableTraceName(circuitJson, trace.pcb_trace_id)
      errors.push({
        ...commonError,
        message: `Trace [${traceName}] has disconnected endpoint at (${endpoint.x.toFixed(2)}, ${endpoint.y.toFixed(2)})`,
        pcb_trace_error_id: `disconnected_endpoint_${trace.pcb_trace_id}_${index === 0 ? "start" : "end"}`,
        center: { x: endpoint.x, y: endpoint.y },
        pcb_port_ids: [],
      })
    }
  }
  return errors
}
