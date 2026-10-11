// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import {
  all_layers,
  type AnyCircuitElement,
  type PcbTrace,
  type PcbVia,
} from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getPrimaryId } from "@tscircuit/circuit-json-util"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { getPads, getPadToPadGap } from "../check-pad-clearance/common"
import { isPointInPad } from "./is-point-in-pad"
import { getLayersOfPcbElement } from "../util/getLayersOfPcbElement"

type ViaContact = {
  x: number
  y: number
  ownerTraceId?: string
  radius?: number
  touchesPad: boolean
  touchingTraceIds: Set<string>
}

type ViaContactIndex = Map<string, Map<string, ViaContact[]>>
const CONTACT_EPSILON = 1e-9

/** Index actual via copper independently of lateral trace segments. */
export function getViaContactIndex(
  circuitJson: AnyCircuitElement[],
  connectivity: ConnectivityMap,
): ViaContactIndex {
  const index: ViaContactIndex = new Map()
  const pads = getPads(circuitJson)
  const traces = circuitJson.filter((element) => element.type === "pcb_trace")
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const board = circuitJson.find((element) => element.type === "pcb_board")
  const layerCount = board?.num_layers
  const innerLayers = all_layers.filter((layer) => layer.startsWith("inner"))
  const stack = [
    "top",
    ...innerLayers.slice(
      0,
      layerCount === undefined ? undefined : Math.max(0, layerCount - 2),
    ),
    ...(layerCount === 1 ? [] : ["bottom"]),
  ]
  const add = (
    id: string,
    layers: string[],
    contact: Omit<ViaContact, "touchesPad" | "touchingTraceIds">,
  ) => {
    if (![contact.x, contact.y].every(Number.isFinite)) return
    const net = connectivity.getNetConnectedToId(id)
    if (!net) return
    const touchesPad = pads.some((pad) => {
      if (
        connectivity.getNetConnectedToId(getPrimaryId(pad)) !== net ||
        !getLayersOfPcbElement(pad).some((layer) => layers.includes(layer))
      )
        return false
      if (contact.radius === undefined) return isPointInPad(contact, pad)
      const viaGeometry = {
        type: "pcb_via",
        pcb_via_id: id,
        x: contact.x,
        y: contact.y,
        outer_diameter: contact.radius * 2,
        hole_diameter: 0,
        layers,
      } as PcbVia
      return getPadToPadGap(viaGeometry, pad) <= CONTACT_EPSILON
    })
    const touchingTraceIds = new Set<string>()
    for (const trace of traces) {
      if (
        trace.route_thickness_mode === "interpolated" ||
        connectivity.getNetConnectedToId(trace.pcb_trace_id) !== net
      )
        continue
      for (let i = 1; i < trace.route.length; i++) {
        const a = trace.route[i - 1]!,
          b = trace.route[i]!
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer ||
          !layers.includes(a.layer) ||
          !Number.isFinite(a.width) ||
          a.width <= 0 ||
          Math.hypot(a.x - b.x, a.y - b.y) <= CONTACT_EPSILON
        )
          continue
        const reach =
          contact.radius === undefined ? 0 : contact.radius + a.width / 2
        if (pointToSegmentDistance(contact, a, b) <= reach + CONTACT_EPSILON) {
          touchingTraceIds.add(trace.pcb_trace_id)
          break
        }
      }
    }
    const copper: ViaContact = { ...contact, touchesPad, touchingTraceIds }
    const byLayer = index.get(net) ?? new Map<string, ViaContact[]>()
    for (const layer of layers) {
      const contacts = byLayer.get(layer) ?? []
      contacts.push(copper)
      byLayer.set(layer, contacts)
    }
    index.set(net, byLayer)
  }

  for (const via of vias) {
    if (!Number.isFinite(via.outer_diameter) || via.outer_diameter <= 0)
      continue
    add(via.pcb_via_id, getLayersOfPcbElement(via), {
      x: via.x,
      y: via.y,
      ownerTraceId: via.pcb_trace_id,
      radius: via.outer_diameter / 2,
    })
  }

  // Route-only inputs may not have materialized pcb_via records yet. Expand
  // their physical span using the board stack, including intermediate layers.
  for (const trace of circuitJson) {
    if (trace.type !== "pcb_trace") continue
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      if (
        vias.some(
          (via) =>
            Math.hypot(via.x - point.x, via.y - point.y) <= CONTACT_EPSILON &&
            (via.pcb_trace_id === trace.pcb_trace_id ||
              (!via.pcb_trace_id &&
                connectivity.areIdsConnected(
                  via.pcb_via_id,
                  trace.pcb_trace_id,
                ))),
        )
      )
        continue
      const from = stack.indexOf(point.from_layer)
      const to = stack.indexOf(point.to_layer)
      if (from < 0 || to < 0) continue
      const diameter = point.outer_diameter
      if (
        diameter !== undefined &&
        (!Number.isFinite(diameter) || diameter <= 0)
      )
        continue
      add(
        trace.pcb_trace_id,
        stack.slice(Math.min(from, to), Math.max(from, to) + 1),
        {
          x: point.x,
          y: point.y,
          ownerTraceId: trace.pcb_trace_id,
          radius: diameter === undefined ? undefined : diameter / 2,
        },
      )
    }
  }
  return index
}

export function endpointTouchesVia({
  point,
  width,
  ownerTrace,
  index,
  connectivity,
}: {
  point: PcbTrace["route"][number]
  width: number
  ownerTrace: PcbTrace
  index: ViaContactIndex
  connectivity: ConnectivityMap
}): boolean {
  if (point.route_type !== "wire" || !Number.isFinite(width) || width <= 0)
    return false
  const net = connectivity.getNetConnectedToId(ownerTrace.pcb_trace_id)
  if (!net) return false
  return (index.get(net)?.get(point.layer) ?? []).some((via) => {
    if (via.ownerTraceId === ownerTrace.pcb_trace_id) return false
    // A lone via does not establish an onward connection. Its barrel must
    // reach a same-net pad or another nondegenerate trace on a physical layer.
    if (
      !via.touchesPad &&
      ![...via.touchingTraceIds].some((id) => id !== ownerTrace.pcb_trace_id)
    )
      return false
    // When a route-only via has no diameter, certify exact center contact only.
    const contactDistance =
      via.radius === undefined ? 0 : via.radius + width / 2
    return (
      Math.hypot(point.x - via.x, point.y - via.y) <=
      contactDistance + CONTACT_EPSILON
    )
  })
}
