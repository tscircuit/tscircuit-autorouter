import type { ReferenceDrcPrimitiveMemo } from "../../../ReferenceDrcPrimitiveMemo"
import type { ScaledConductorPolygonMemo } from "../../../ScaledConductorPolygonMemo"
import type { ReferenceDrcTracePairFactExecutor } from "../../../prepareReferenceDrcTracePairFacts"
import { prepareReferenceDrcPolygonFacts } from "../../../prepareReferenceDrcPolygonFacts"
// Pinned from @tscircuit/checks 0.0.233 bundled source; see the authoritative-drc-fork LICENSE and PROVENANCE.md.
import type { Polygon } from "@flatten-js/core"
import { all_layers, type AnyCircuitElement, type PcbVia } from "circuit-json"
import {
  circlePolygon,
  getPourPolygon,
  getTraceSegmentPolygon,
} from "@tscircuit/circuit-json-util"
import Flatbush from "flatbush"
import { createCopperPolygonContactTester } from "../copper-pour-connectivity/create-copper-polygon-contact-tester"

type Conductor = {
  id: string
  layers: string[]
  polygon: Polygon
  bridges: boolean
  geometryId: number
}

/** Add physical barrel/pour edges in board-world mm. Logical net membership
 * never joins copper; holes in pours and the emitted via layer span are retained.
 * Wire/wire intersections remain handled by the existing trace index.
 * Pads stay in the dedicated port/pour checks: adding their IDs here would
 * let a partial pour connection satisfy a named-net port prematurely.
 */
export function getViaAndPourConnections(
  circuit: AnyCircuitElement[],
  primitiveMemo?: ReferenceDrcPrimitiveMemo,
  scaledPolygonMemo?: ScaledConductorPolygonMemo,
  preparedFactExecutor?: ReferenceDrcTracePairFactExecutor,
): string[][] {
  if (
    !circuit.some(
      (e) =>
        e.type === "pcb_via" ||
        e.type === "pcb_copper_pour" ||
        (e.type === "pcb_trace" && e.route.some((p) => p.route_type === "via")),
    )
  )
    return []
  const conductors: Conductor[] = []
  const connections: string[][] = []
  const scale = 1e6
  const tolerance = 1e-7 * scale
  const touches = createCopperPolygonContactTester(tolerance)
  const add = (
    id: string,
    layers: string[],
    polygon: Polygon,
    bridges = false,
    geometryId = 0,
  ): void => {
    if (!polygon.isEmpty())
      conductors.push({
        id,
        layers,
        polygon: polygon.scale(scale, scale),
        bridges,
        geometryId,
      })
  }
  const vias = circuit.filter((e) => e.type === "pcb_via")
  const addMemoized = (
    id: string,
    layers: string[],
    geometryId: number,
    createPolygon: () => Polygon,
    bridges = false,
  ): void => {
    const polygon = scaledPolygonMemo!.getOrCreate(geometryId, createPolygon)
    if (polygon !== undefined) conductors.push({ id, layers, polygon, bridges, geometryId })
  }
  const board = circuit.find((e) => e.type === "pcb_board")
  const stack = [
    "top",
    ...all_layers
      .filter((l) => l.startsWith("inner"))
      .slice(0, board ? Math.max(0, board.num_layers - 2) : undefined),
    ...(board?.num_layers === 1 ? [] : ["bottom"]),
  ]
  for (const copper of circuit) {
    if (copper.type === "pcb_via") {
      if (primitiveMemo && scaledPolygonMemo) addMemoized(
        copper.pcb_via_id,
        copper.layers,
        primitiveMemo.intern(["via", copper]),
        (): Polygon => circlePolygon(copper, copper.outer_diameter / 2),
        true,
      )
      else add(
        copper.pcb_via_id,
        copper.layers,
        circlePolygon(copper, copper.outer_diameter / 2),
        true,
        primitiveMemo ? primitiveMemo.intern(["via", copper]) : 0,
      )
      if (copper.pcb_trace_id)
        connections.push([copper.pcb_via_id, copper.pcb_trace_id])
    } else if (copper.type === "pcb_copper_pour") {
      if (primitiveMemo && scaledPolygonMemo) addMemoized(
        copper.pcb_copper_pour_id,
        [copper.layer],
        primitiveMemo.intern(["pour", copper]),
        (): Polygon => getPourPolygon(copper),
        true,
      )
      else add(
        copper.pcb_copper_pour_id,
        [copper.layer],
        getPourPolygon(copper),
        true,
        primitiveMemo ? primitiveMemo.intern(["pour", copper]) : 0,
      )
    } else if (copper.type === "pcb_trace") {
      if (copper.route_thickness_mode === "interpolated") continue
      for (let i = 0; i < copper.route.length; i++) {
        const a = copper.route[i],
          b = copper.route[i + 1]
        if (
          a.route_type === "wire" &&
          b?.route_type === "wire" &&
          a.layer === b.layer &&
          (a.x !== b.x || a.y !== b.y)
        ) {
          if (primitiveMemo && scaledPolygonMemo) addMemoized(
            copper.pcb_trace_id,
            [a.layer],
            primitiveMemo.intern(["wire", a, b, a.width]),
            (): Polygon => getTraceSegmentPolygon(a, b, a.width),
          )
          else add(
            copper.pcb_trace_id,
            [a.layer],
            getTraceSegmentPolygon(a, b, a.width),
            false,
            primitiveMemo ? primitiveMemo.intern(["wire", a, b, a.width]) : 0,
          )
        } else if (a.route_type === "via") {
          // A materialized via is authoritative (especially for blind/buried spans).
          if (
            vias.some(
              (v) =>
                v.pcb_trace_id === copper.pcb_trace_id &&
                Math.hypot(v.x - a.x, v.y - a.y) < 1e-9,
            )
          )
            continue
          const from = stack.indexOf(a.from_layer),
            to = stack.indexOf(a.to_layer)
          if (from < 0 || to < 0 || !a.outer_diameter) continue
          const via = {
            type: "pcb_via",
            pcb_via_id: `${copper.pcb_trace_id}_via_${i}`,
            x: a.x,
            y: a.y,
            outer_diameter: a.outer_diameter,
            hole_diameter: 0,
            layers: stack.slice(Math.min(from, to), Math.max(from, to) + 1),
          } as PcbVia
          if (primitiveMemo && scaledPolygonMemo) addMemoized(
            copper.pcb_trace_id,
            via.layers,
            primitiveMemo.intern(["route-via", via]),
            (): Polygon => circlePolygon(via, via.outer_diameter / 2),
            true,
          )
          else add(
            copper.pcb_trace_id,
            via.layers,
            circlePolygon(via, via.outer_diameter / 2),
            true,
            primitiveMemo ? primitiveMemo.intern(["route-via", via]) : 0,
          )
        }
      }
    }
  }
  if (!conductors.length) return connections
  const index = new Flatbush(conductors.length)
  for (const { polygon } of conductors) {
    const b = polygon.box
    index.add(b.xmin, b.ymin, b.xmax, b.ymax)
  }
  index.finish()
  const preparedPolygons = prepareReferenceDrcPolygonFacts(primitiveMemo, conductors, index, tolerance, preparedFactExecutor)
  for (const [i, a] of conductors.entries()) {
    if (!a.bridges) continue
    const box = a.polygon.box
    for (const j of index.search(
      box.xmin - tolerance,
      box.ymin - tolerance,
      box.xmax + tolerance,
      box.ymax + tolerance,
    )) {
      const b = conductors[j]
      if (
        i === j ||
        a.id === b.id ||
        (b.bridges && j < i) ||
        !a.layers.some((l) => b.layers.includes(l))
      )
        continue
      if (preparedPolygons
        ? preparedPolygons.consume(i, j, (): boolean => touches(a.polygon, b.polygon))
        : primitiveMemo
        ? primitiveMemo.getOrCompute("polygon-contact", [a.geometryId, b.geometryId, tolerance],
            (): boolean => touches(a.polygon, b.polygon))
        : touches(a.polygon, b.polygon)) connections.push([a.id, b.id])
    }
  }
  preparedPolygons?.finish()
  return connections
}
