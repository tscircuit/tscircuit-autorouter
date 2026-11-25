import {
  circlePolygon,
  copperPolygonsTouch,
  getPlatedHolePolygon,
  getSmtPadPolygon,
  getTraceSegmentPolygon,
  getPrimaryId,
} from "@tscircuit/circuit-json-util"
import { type Point, doesLineIntersectLine } from "@tscircuit/math-utils"
import type { PcbTrace, PcbSmtPad, PcbPlatedHole } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import RBush from "rbush"

type Wire = Extract<PcbTrace["route"][number], { route_type: "wire" }>
export type WireSegment = { trace: PcbTrace; start: Wire; end: Wire }
export type ViaContact = Point & {
  id: string
  layers: string[]
  radius?: number
  ownerTraceId?: string
}

const wireSegmentsTouch = (
  first: WireSegment,
  second: WireSegment,
): boolean => {
  const minX = Math.min(first.start.x, first.end.x)
  const minY = Math.min(first.start.y, first.end.y)
  const maxX = Math.max(first.start.x, first.end.x)
  const maxY = Math.max(first.start.y, first.end.y)
  const lineThickness = (first.start.width + second.start.width) / 2
  const expansion = Math.max(0, lineThickness) + 1e-9
  // Preserve the connectivity predicate's bounds guard for very short segments.
  if (
    Number.isFinite(minX) &&
    Number.isFinite(minY) &&
    Number.isFinite(maxX) &&
    Number.isFinite(maxY) &&
    Number.isFinite(second.start.x) &&
    Number.isFinite(second.start.y) &&
    Number.isFinite(second.end.x) &&
    Number.isFinite(second.end.y) &&
    Number.isFinite(lineThickness) &&
    (Math.min(second.start.x, second.end.x) > maxX + expansion ||
      Math.max(second.start.x, second.end.x) < minX - expansion ||
      Math.min(second.start.y, second.end.y) > maxY + expansion ||
      Math.max(second.start.y, second.end.y) < minY - expansion)
  )
    return false
  return doesLineIntersectLine(
    [first.start, first.end],
    [second.start, second.end],
    { lineThickness },
  )
}

/** Build copper islands from layer and shape contact. Each pad is a separate conductor. */
export function getPhysicalTraceConnectivity({
  segments,
  vias,
  pads,
  touchedPadsByTrace,
  viaConnections,
}: {
  segments: WireSegment[]
  vias: ViaContact[]
  pads: Array<PcbSmtPad | PcbPlatedHole>
  touchedPadsByTrace: Map<string, string[]>
  viaConnections: string[][]
}): ConnectivityMap {
  const map = new ConnectivityMap({})
  const connections = [...viaConnections]
  const indexedSegments = segments.map((segment, order) => ({
    ...segment,
    order,
    minX:
      Math.min(segment.start.x, segment.end.x) - segment.start.width / 2 - 1e-9,
    minY:
      Math.min(segment.start.y, segment.end.y) - segment.start.width / 2 - 1e-9,
    maxX:
      Math.max(segment.start.x, segment.end.x) + segment.start.width / 2 + 1e-9,
    maxY:
      Math.max(segment.start.y, segment.end.y) + segment.start.width / 2 + 1e-9,
  }))
  const segmentIndex = new RBush<(typeof indexedSegments)[number]>().load(
    indexedSegments,
  )
  for (const segment of indexedSegments) {
    for (const candidate of segmentIndex.search(segment)) {
      if (
        candidate.order <= segment.order ||
        candidate.trace.pcb_trace_id === segment.trace.pcb_trace_id ||
        candidate.start.layer !== segment.start.layer
      )
        continue
      if (wireSegmentsTouch(segment, candidate))
        connections.push([
          segment.trace.pcb_trace_id,
          candidate.trace.pcb_trace_id,
        ])
    }
  }
  for (const [id, touched] of touchedPadsByTrace)
    connections.push([id, ...touched])
  type Conductor = {
    id: string
    layers: string[]
    geometry:
      | { kind: "polygon"; polygon: ReturnType<typeof circlePolygon> }
      | {
          kind: "segment"
          segment: WireSegment
          polygon?: ReturnType<typeof circlePolygon>
        }
    bridge: boolean
    platedPort: boolean
    minX: number
    minY: number
    maxX: number
    maxY: number
  }
  const conductors: Conductor[] = []
  const addConductor = (
    id: string,
    layers: string[],
    polygon: ReturnType<typeof circlePolygon>,
    bridge: boolean,
    platedPort = false,
  ): void => {
    if (polygon.isEmpty()) return
    const scaled = polygon.scale(1e6, 1e6)
    const box = scaled.box
    conductors.push({
      id,
      layers,
      geometry: { kind: "polygon", polygon: scaled },
      bridge,
      platedPort,
      minX: box.xmin,
      minY: box.ymin,
      maxX: box.xmax,
      maxY: box.ymax,
    })
  }
  for (const via of vias) {
    if (via.radius === undefined) continue
    addConductor(via.id, via.layers, circlePolygon(via, via.radius), true)
  }
  for (const pad of pads) {
    if (!pad.pcb_port_id) continue
    if (pad.type === "pcb_smtpad") {
      if (vias.length)
        addConductor(
          getPrimaryId(pad)!,
          [pad.layer],
          getSmtPadPolygon(pad),
          false,
        )
      continue
    }
    addConductor(
      getPrimaryId(pad)!,
      pad.layers,
      getPlatedHolePolygon(pad),
      true,
      true,
    )
  }
  for (const segment of segments) {
    if (
      segment.trace.route_thickness_mode === "interpolated" ||
      (segment.start.x === segment.end.x && segment.start.y === segment.end.y)
    )
      continue
    const radius = segment.start.width / 2
    if (!Number.isFinite(radius) || radius <= 0) {
      addConductor(
        segment.trace.pcb_trace_id,
        [segment.start.layer],
        getTraceSegmentPolygon(segment.start, segment.end, segment.start.width),
        false,
      )
      continue
    }
    // Construct copper polygons only for segments near a layer bridge.
    conductors.push({
      id: segment.trace.pcb_trace_id,
      layers: [segment.start.layer],
      geometry: { kind: "segment", segment },
      bridge: false,
      platedPort: false,
      minX: (Math.min(segment.start.x, segment.end.x) - radius) * 1e6 - 0.1,
      minY: (Math.min(segment.start.y, segment.end.y) - radius) * 1e6 - 0.1,
      maxX: (Math.max(segment.start.x, segment.end.x) + radius) * 1e6 + 0.1,
      maxY: (Math.max(segment.start.y, segment.end.y) + radius) * 1e6 + 0.1,
    })
  }
  const getConductorPolygon = (
    conductor: Conductor,
  ): ReturnType<typeof circlePolygon> => {
    const geometry = conductor.geometry
    if (geometry.kind === "polygon") return geometry.polygon
    if (!geometry.polygon) {
      const { start, end } = geometry.segment
      geometry.polygon = getTraceSegmentPolygon(start, end, start.width).scale(
        1e6,
        1e6,
      )
    }
    return geometry.polygon
  }
  const conductorIndex = new RBush<Conductor>().load(conductors)
  for (const conductor of conductors) {
    if (!conductor.bridge) continue
    for (const candidate of conductorIndex.search({
      minX: conductor.minX - 0.1,
      minY: conductor.minY - 0.1,
      maxX: conductor.maxX + 0.1,
      maxY: conductor.maxY + 0.1,
    })) {
      if (
        candidate.id === conductor.id ||
        (conductor.platedPort && candidate.bridge) ||
        (candidate.platedPort && conductor.bridge) ||
        !candidate.layers.some((layer) => conductor.layers.includes(layer))
      )
        continue
      const polygon = getConductorPolygon(candidate)
      const box = polygon.box
      // Match the original bounds before testing the exact copper contact.
      if (
        polygon.isEmpty() ||
        box.xmax < conductor.minX - 0.1 ||
        box.ymax < conductor.minY - 0.1 ||
        box.xmin > conductor.maxX + 0.1 ||
        box.ymin > conductor.maxY + 0.1
      )
        continue
      if (copperPolygonsTouch(getConductorPolygon(conductor), polygon, 0.1))
        connections.push([conductor.id, candidate.id])
    }
  }
  map.addConnections(connections)
  return map
}
