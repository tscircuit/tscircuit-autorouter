import { isPointInsidePolygon, pointToSegmentDistance, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import Flatbush from "flatbush"
import { mapLayerNameToZ } from "../../lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "../../lib/utils/mapZToLayerName"

type Point = { x: number; y: number }
type Shape = { kind: "stroke"; a: Point; b: Point; radius: number } | { kind: "polygon"; points: Point[] }
type Conductor = {
  shape: Shape
  layers: string[]
  sourceType: "wire" | "via" | "pad"
  padPortId?: string
  bounds: [number, number, number, number]
}

export type PhysicalContact = { component: number; sourceType: Conductor["sourceType"]; padPortId?: string }
export type PhysicalConnectivity = { getContacts: (point: Point, layers: string[]) => PhysicalContact[] }

const polygonEdges = (points: Point[]): Array<[Point, Point]> =>
  points.map((point, index): [Point, Point] => [point, points[(index + 1) % points.length]!])

const contains = (shape: Shape, point: Point): boolean => shape.kind === "stroke"
  ? pointToSegmentDistance(point, shape.a, shape.b) <= shape.radius + 1e-9
  : isPointInsidePolygon(point, shape.points) || polygonEdges(shape.points).some(([a, b]) => pointToSegmentDistance(point, a, b) <= 1e-9)

const touches = (a: Shape, b: Shape): boolean => {
  if (a.kind === "stroke" && b.kind === "stroke") {
    return segmentToSegmentMinDistance(a.a, a.b, b.a, b.b) <= a.radius + b.radius + 1e-9
  }
  if (a.kind === "polygon" && b.kind === "polygon") {
    return contains(a, b.points[0]!) || contains(b, a.points[0]!) ||
      polygonEdges(a.points).some(([a0, a1]) => polygonEdges(b.points).some(([b0, b1]) => segmentToSegmentMinDistance(a0, a1, b0, b1) <= 1e-9))
  }
  const polygon = a.kind === "polygon" ? a : b
  const stroke = a.kind === "stroke" ? a : b
  if (polygon.kind !== "polygon" || stroke.kind !== "stroke") throw new Error("Invalid contact shape pair")
  return contains(polygon, stroke.a) || contains(polygon, stroke.b) ||
    polygonEdges(polygon.points).some(([p0, p1]) => segmentToSegmentMinDistance(stroke.a, stroke.b, p0, p1) <= stroke.radius + 1e-9)
}

const rectangle = (center: Point, width: number, height: number, rotation = 0): Shape => {
  const angle = rotation * Math.PI / 180
  const cos = Math.cos(angle), sin = Math.sin(angle)
  return { kind: "polygon", points: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
    const dx = x! * width / 2, dy = y! * height / 2
    return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
  }) }
}

/** Build copper components from geometry, without trace/port identity joins. */
export const buildPhysicalConnectivity = (circuitJson: AnyCircuitElement[], layerCount: number): PhysicalConnectivity => {
  const conductors: Conductor[] = []
  const boardLayers = new Set<string>(Array.from({ length: layerCount }, (_, index) => mapZToLayerName(index, layerCount)))
  const span = (layers: readonly string[]): string[] => {
    const zs = layers.map((layer) => mapLayerNameToZ(layer, layerCount))
    if (zs.length === 0 || layers.some((layer) => !boardLayers.has(layer))) throw new Error("Invalid conductor layer span")
    const first = Math.min(...zs), last = Math.max(...zs)
    return Array.from({ length: last - first + 1 }, (_, index) => mapZToLayerName(first + index, layerCount))
  }
  const add = (shape: Shape, layers: string[], sourceType: Conductor["sourceType"], padPortId?: string): void => {
    const points = shape.kind === "stroke" ? [shape.a, shape.b] : shape.points
    const radius = shape.kind === "stroke" ? shape.radius : 0
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) || !Number.isFinite(radius) || radius < 0) throw new Error("Invalid copper geometry")
    conductors.push({ shape, layers, sourceType, padPortId, bounds: [
      Math.min(...points.map((point) => point.x)) - radius - 1e-9,
      Math.min(...points.map((point) => point.y)) - radius - 1e-9,
      Math.max(...points.map((point) => point.x)) + radius + 1e-9,
      Math.max(...points.map((point) => point.y)) + radius + 1e-9,
    ] })
  }
  for (const element of circuitJson) {
    if (element.type === "pcb_trace") {
      for (let index = 1; index < element.route.length; index++) {
        const a = element.route[index - 1]!, b = element.route[index]!
        if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer) {
          add({ kind: "stroke", a, b, radius: a.width / 2 }, [a.layer], "wire")
        }
      }
    } else if (element.type === "pcb_via") {
      add({ kind: "stroke", a: element, b: element, radius: element.outer_diameter / 2 }, span(element.layers), "via")
    } else if (element.type === "pcb_smtpad") {
      if (element.shape === "rect" || element.shape === "rotated_rect") {
        add(rectangle(element, element.width, element.height, element.shape === "rotated_rect" ? element.ccw_rotation : 0), [element.layer], "pad", element.pcb_port_id)
      } else if (element.shape === "circle") {
        add({ kind: "stroke", a: element, b: element, radius: element.radius }, [element.layer], "pad", element.pcb_port_id)
      } else {
        throw new Error(`Unsupported SMT coverage geometry: ${element.shape}`)
      }
    } else if (element.type === "pcb_plated_hole") {
      // Imported through holes may list generic inner planes absent from this board.
      // Only the board's actual copper planes participate in their physical barrel.
      if (element.layers.some((layer) => layer !== "top" && layer !== "bottom" && !/^inner[1-9]\d*$/.test(layer))) throw new Error("Invalid plated-hole layer")
      const layers = span(element.layers.filter((layer) => boardLayers.has(layer)))
      if (element.shape === "circle") {
        add({ kind: "stroke", a: element, b: element, radius: element.outer_diameter / 2 }, layers, "pad", element.pcb_port_id)
      } else if ("rect_pad_width" in element && "rect_pad_height" in element) {
        const rotation = "rect_ccw_rotation" in element ? element.rect_ccw_rotation ?? 0 : 0
        add(rectangle(element, element.rect_pad_width, element.rect_pad_height, rotation), layers, "pad", element.pcb_port_id)
      } else {
        throw new Error(`Unsupported plated-hole coverage geometry: ${element.shape}`)
      }
    }
  }
  const parents = conductors.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parents[root] !== root) root = parents[root]!
    while (index !== root) {
      const parent = parents[index]!
      parents[index] = root
      index = parent
    }
    return root
  }
  const byLayer = new Map<string, number[]>()
  for (const [index, conductor] of conductors.entries()) for (const layer of conductor.layers) {
    const indices = byLayer.get(layer) ?? []
    indices.push(index)
    byLayer.set(layer, indices)
  }
  const layerIndexes = new Map<string, { indices: number[]; index: Flatbush }>()
  for (const [layer, indices] of byLayer) {
    const index = new Flatbush(indices.length)
    for (const conductorIndex of indices) index.add(...conductors[conductorIndex]!.bounds)
    index.finish()
    for (const [i, conductorIndex] of indices.entries()) {
      const conductor = conductors[conductorIndex]!
      for (const j of index.search(...conductor.bounds)) {
        if (j <= i) continue
        const otherIndex = indices[j]!
        if (find(conductorIndex) !== find(otherIndex) && touches(conductor.shape, conductors[otherIndex]!.shape)) parents[find(otherIndex)] = find(conductorIndex)
      }
    }
    layerIndexes.set(layer, { indices, index })
  }
  return {
    getContacts: (point: Point, layers: string[]): PhysicalContact[] => {
      const result: PhysicalContact[] = []
      const seen = new Set<number>()
      for (const layer of layers) {
        const entry = layerIndexes.get(layer)
        if (!entry) continue
        for (const hit of entry.index.search(point.x - 1e-9, point.y - 1e-9, point.x + 1e-9, point.y + 1e-9)) {
          const conductorIndex = entry.indices[hit]!
          const conductor = conductors[conductorIndex]!
          if (seen.has(conductorIndex) || !contains(conductor.shape, point)) continue
          seen.add(conductorIndex)
          result.push({ component: find(conductorIndex), sourceType: conductor.sourceType, padPortId: conductor.padPortId })
        }
      }
      return result
    },
  }
}
