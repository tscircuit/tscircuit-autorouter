import { pointToSegmentClosestPoint, segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { ContactHalfspace } from "./ContactHalfspaceSolver"

export type ContactVertex = {
  point: { x: number; y: number }
  /** First XY displacement variable; -1 denotes an immutable terminal/obstacle. */
  variable: number
}
export type ContactPrimitive = {
  vertices: ContactVertex[]
  radius: number
  minZ: number
  maxZ: number
  owner: number
  via: boolean
  excludedOwners?: ReadonlySet<number>
}
export type PolylineContact = {
  a: ContactPrimitive
  b: ContactPrimitive
  required: number
  distance: number
}
export type ContactGeometryRules = {
  margin: number
  viaGap: number
  viaPadGap?: number
  drillSeparation: number
  sameNet: (a: number, b: number) => boolean
}
type Point = { x: number; y: number }
type Envelope = { primitive: ContactPrimitive; minX: number; maxX: number; minY: number; maxY: number }

export const contactPrimitiveDistance = (a: ContactPrimitive, b: ContactPrimitive): number => {
  const a0 = a.vertices[0]!.point
  const a1 = a.vertices[a.vertices.length - 1]!.point
  const b0 = b.vertices[0]!.point
  const b1 = b.vertices[b.vertices.length - 1]!.point
  return segmentToSegmentMinDistance(a0, a1, b0, b1)
}

/** Sweep conservative swept envelopes, then test only potentially active pairs. */
export const collectPolylineContacts = (
  primitives: readonly ContactPrimitive[],
  rules: ContactGeometryRules,
  trustBoxRadius: number,
  charge: (units: number) => void = (): void => {},
): { contacts: PolylineContact[]; envelopePairs: number; distantPairs: number } => {
  const maximumGap = Math.max(rules.margin, rules.viaGap, rules.viaPadGap ?? rules.margin, rules.drillSeparation) + 1e-5
  const motion = (p: ContactPrimitive): number =>
    p.vertices.some((v): boolean => v.variable >= 0) ? Math.SQRT2 * trustBoxRadius : 0
  const envelopes: Envelope[] = primitives.map((primitive): Envelope => {
    charge(1 + primitive.vertices.length)
    const padding = primitive.radius + maximumGap / 2 + motion(primitive)
    return {
      primitive,
      minX: Math.min(...primitive.vertices.map((v): number => v.point.x)) - padding,
      maxX: Math.max(...primitive.vertices.map((v): number => v.point.x)) + padding,
      minY: Math.min(...primitive.vertices.map((v): number => v.point.y)) - padding,
      maxY: Math.max(...primitive.vertices.map((v): number => v.point.y)) + padding,
    }
  }).sort((a, b): number => {
    charge(1)
    return a.minX - b.minX
  })
  const contacts: PolylineContact[] = []
  let envelopePairs = 0
  let distantPairs = 0
  for (let i = 0; i < envelopes.length; i++) {
    const left = envelopes[i]!
    const a = left.primitive
    for (let j = i + 1; j < envelopes.length; j++) {
      charge(1)
      const right = envelopes[j]!
      if (right.minX > left.maxX) break
      const b = right.primitive
      if (right.minY > left.maxY || right.maxY < left.minY) continue
      if (a.owner < 0 && b.owner < 0) continue
      if (a.excludedOwners?.has(b.owner) || b.excludedOwners?.has(a.owner)) continue
      const sameNet = a.owner >= 0 && b.owner >= 0 && rules.sameNet(a.owner, b.owner)
      if (sameNet && !(a.via && b.via)) continue
      const overlappingLayers = a.minZ <= b.maxZ && b.minZ <= a.maxZ
      // Drill spacing is owner-independent and is checked even for disjoint spans.
      if (!overlappingLayers && !(a.via && b.via)) continue
      if (sameNet && a.via && b.via &&
        a.vertices[0]!.variable === b.vertices[0]!.variable &&
        a.vertices[0]!.point.x === b.vertices[0]!.point.x &&
        a.vertices[0]!.point.y === b.vertices[0]!.point.y) continue
      let required = a.radius + b.radius + rules.margin
      if ((a.via && b.owner < 0) || (b.via && a.owner < 0))
        required = a.radius + b.radius + (rules.viaPadGap ?? rules.margin)
      if (a.via && b.via) required = Math.max(
        rules.drillSeparation,
        overlappingLayers ? a.radius + b.radius + rules.viaGap : 0,
      )
      const distance = contactPrimitiveDistance(a, b)
      envelopePairs++
      // A segment's Hausdorff displacement is bounded by its maximum endpoint
      // motion. The distance between two segments can fall by at most their sum.
      if (distance > required + motion(a) + motion(b) + 1e-5) {
        distantPairs++
        continue
      }
      contacts.push({ a, b, required, distance })
    }
  }
  return { contacts, envelopePairs, distantPairs }
}

/** Fixed unit normals and all endpoint pairs certify separation of full capsules. */
export const buildPolylineContactRows = (
  contact: PolylineContact,
  normalChoice: number,
  charge: (units: number) => void = (): void => {},
): ContactHalfspace[] => {
  const a = contact.a.vertices
  const b = contact.b.vertices
  const normals: Point[] = []
  const addNormal = (x: number, y: number): void => {
    charge(1 + normals.length)
    const length = Math.hypot(x, y)
    if (length < 1e-10) return
    x /= length
    y /= length
    if (!normals.some((n): boolean => Math.abs(n.x - x) + Math.abs(n.y - y) < 1e-8))
      normals.push({ x, y })
  }
  for (const [left, right] of [[a, b], [b, a]]) {
    const first = right![0]!.point
    const last = right![right!.length - 1]!.point
    const sign = left === a ? 1 : -1
    for (const vertex of left!) {
      const closest = pointToSegmentClosestPoint(vertex.point, first, last)
      addNormal(sign * (closest.x - vertex.point.x), sign * (closest.y - vertex.point.y))
    }
    addNormal(last.y - first.y, first.x - last.x)
    addNormal(first.y - last.y, last.x - first.x)
  }
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) addNormal(x!, y!)
  const gap = (n: Point): number => Math.min(...b.map((v): number => n.x * v.point.x + n.y * v.point.y)) -
    Math.max(...a.map((v): number => n.x * v.point.x + n.y * v.point.y))
  normals.sort((left, right): number => {
    charge(a.length + b.length)
    return gap(right) - gap(left)
  })
  // A crossing has no unique signed-distance gradient. Rotating an explicit,
  // finite side choice on stagnation does not claim global infeasibility.
  const n = normals[normalChoice % normals.length]!
  const rows: ContactHalfspace[] = []
  for (const va of a) for (const vb of b) {
    charge(1)
    const coefficients = new Map<number, number>()
    for (const [vertex, sign] of [[va, 1], [vb, -1]] as const) {
      if (vertex.variable < 0) continue
      coefficients.set(vertex.variable, (coefficients.get(vertex.variable) ?? 0) + sign * n.x)
      coefficients.set(vertex.variable + 1, (coefficients.get(vertex.variable + 1) ?? 0) + sign * n.y)
    }
    rows.push({
      terms: [...coefficients].filter(([, coefficient]): boolean => coefficient !== 0)
        .map(([variable, coefficient]): { variable: number; coefficient: number } => ({ variable, coefficient })),
      maximum: n.x * (vb.point.x - va.point.x) + n.y * (vb.point.y - va.point.y) - contact.required - 1e-5,
      soft: true,
    })
  }
  return rows
}
