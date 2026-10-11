import { Arc, Point, Polygon, Segment } from "@flatten-js/core"
import { assertNativeSourceAliasOutput } from "../nativeSourceAliasProvenance"
import { createCopperPolygonContactTester } from "./native/lib/copper-pour-connectivity/create-copper-polygon-contact-tester"

type ReferenceDrcPolygonPoint = { x: number; y: number }
type ReferenceDrcPolygonSegment = { kind: "segment"; start: ReferenceDrcPolygonPoint; end: ReferenceDrcPolygonPoint }
type ReferenceDrcPolygonArc = { kind: "arc"; center: ReferenceDrcPolygonPoint; radius: number; startAngle: number; endAngle: number; counterClockwise: boolean }
export type ReferenceDrcPolygonSnapshot = { faces: (ReferenceDrcPolygonSegment | ReferenceDrcPolygonArc)[][] }

const getDescriptor = Object.getOwnPropertyDescriptor
const applyNative = Reflect.apply
const hasOwn = Object.prototype.hasOwnProperty
const isArray = Array.isArray
const isFiniteNative = Number.isFinite
const isSafeInteger = Number.isSafeInteger
const MAX_EDGES = 4_000_000
const NativePoint = Point
const NativeSegment = Segment
const NativeArc = Arc
const NativePolygon = Polygon

function ownValue(object: object, key: string): unknown {
  const descriptor = getDescriptor(object, key)
  if (descriptor === undefined || !applyNative(hasOwn, descriptor, ["value"])) {
    throw new Error(`Expected own polygon fact field ${key}`)
  }
  return descriptor.value
}

function number(value: unknown): asserts value is number {
  if (typeof value !== "number") {
    throw new Error("Polygon fact coordinate must be numeric")
  }
  if (!isFiniteNative(value)) {
    throw new Error("Polygon fact coordinate must be finite")
  }
}

function point(value: unknown): asserts value is ReferenceDrcPolygonPoint {
  if (value === null || typeof value !== "object" || isArray(value)) {
    throw new Error("Polygon fact point must be a plain record")
  }
  number(ownValue(value, "x"))
  number(ownValue(value, "y"))
}

/** Protocol validation precedes every numeric field read or reconstruction. */
export function assertReferenceDrcPolygonSnapshot(value: unknown): asserts value is ReferenceDrcPolygonSnapshot {
  assertNativeSourceAliasOutput(value, [])
  if (value === null || typeof value !== "object" || isArray(value)) throw new Error("Polygon fact snapshot must be a plain record")
  const faces = ownValue(value, "faces")
  if (!isArray(faces) || faces.length >= MAX_EDGES) throw new Error("Polygon fact faces exceed the resource domain")
  let count = 0
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]
    if (!isArray(face)) throw new Error("Polygon fact face must be an array")
    count += face.length
    if (count >= MAX_EDGES) throw new Error("Polygon fact edges exceed the resource domain")
    for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex++) {
      const edge = face[edgeIndex]
      if (edge === null || typeof edge !== "object" || isArray(edge)) throw new Error("Polygon fact edge must be a plain record")
      const kind = ownValue(edge, "kind")
      if (kind === "segment") {
        point(ownValue(edge, "start")); point(ownValue(edge, "end"))
      } else if (kind === "arc") {
        point(ownValue(edge, "center")); number(ownValue(edge, "radius"))
        number(ownValue(edge, "startAngle")); number(ownValue(edge, "endAngle"))
        if (typeof ownValue(edge, "counterClockwise") !== "boolean") throw new Error("Polygon fact arc orientation must be boolean")
      } else throw new Error("Unknown polygon fact edge kind")
    }
  }
}

/**
 * Internal producer only: the complete private checker/native guard owns these
 * polygons. Copy already-scaled raw parameters, never recompute copper or scale.
 * Native scale creates edges in face order; retaining that order reproduces
 * native arc lengths, containment ties and the PlanarSet insertion sequence.
 */
export function captureReferenceDrcPolygonSnapshot(polygon: Polygon): ReferenceDrcPolygonSnapshot {
  const faces: ReferenceDrcPolygonSnapshot["faces"] = []
  for (const face of polygon.faces) {
    const edges: ReferenceDrcPolygonSnapshot["faces"][number] = []
    for (const edge of face) {
      const shape = edge.shape
      if (shape instanceof NativeSegment) edges.push({ kind: "segment", start: { x: shape.ps.x, y: shape.ps.y }, end: { x: shape.pe.x, y: shape.pe.y } })
      else if (shape instanceof NativeArc) edges.push({ kind: "arc", center: { x: shape.pc.x, y: shape.pc.y }, radius: shape.r, startAngle: shape.startAngle, endAngle: shape.endAngle, counterClockwise: shape.counterClockwise })
      else throw new Error("Native conductor has an unsupported polygon edge")
    }
    faces.push(edges)
  }
  const snapshot = { faces }
  assertReferenceDrcPolygonSnapshot(snapshot)
  return snapshot
}

/** All constructors run before fact queries; original main polygons stay owned. */
export function reconstructReferenceDrcPolygon(snapshot: ReferenceDrcPolygonSnapshot): Polygon {
  assertReferenceDrcPolygonSnapshot(snapshot)
  const polygon = new NativePolygon()
  for (let faceIndex = 0; faceIndex < snapshot.faces.length; faceIndex++) {
    const face = snapshot.faces[faceIndex]!
    const shapes: (Segment | Arc)[] = []
    for (let edgeIndex = 0; edgeIndex < face.length; edgeIndex++) {
      const edge = face[edgeIndex]!
      if (edge.kind === "segment") shapes.push(new NativeSegment(new NativePoint(edge.start.x, edge.start.y), new NativePoint(edge.end.x, edge.end.y)))
      else shapes.push(new NativeArc(new NativePoint(edge.center.x, edge.center.y), edge.radius, edge.startAngle, edge.endAngle, edge.counterClockwise))
    }
    polygon.addFace(shapes)
  }
  return polygon
}

/** Isolated pure geometry evaluator, not yet a shared worker protocol kind. */
export function createReferenceDrcPolygonFactEvaluator(snapshots: readonly ReferenceDrcPolygonSnapshot[], tolerance: number): (left: number, right: number) => boolean {
  assertNativeSourceAliasOutput(snapshots, [])
  number(tolerance)
  const polygons: Polygon[] = []
  for (let index = 0; index < snapshots.length; index++) polygons.push(reconstructReferenceDrcPolygon(snapshots[index]!))
  const touches = createCopperPolygonContactTester(tolerance)
  return (left: number, right: number): boolean => {
    if (!isSafeInteger(left) || left < 0 || left >= polygons.length || !isSafeInteger(right) || right < 0 || right >= polygons.length) throw new Error("Polygon fact pair index is out of range")
    return touches(polygons[left]!, polygons[right]!)
  }
}
