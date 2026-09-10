import { createHash } from "node:crypto"

type Point = { x: number; y: number; z: number; traceThickness?: number }
type Terminal = Point & { connectionName: string }
type Route = {
  connectionName: string
  rootConnectionName?: string
  traceThickness: number
  viaDiameter: number
  route: Point[]
  vias: { x: number; y: number }[]
}
type Node = {
  center: { x: number; y: number }
  width: number
  height: number
  portPointsInPairs?: [Terminal, Terminal][]
}
type Segment = { a: Point; b: Point; width: number }

export type NodeQualityInput = {
  node: Node
  routes: Route[]
  traceWidth: number
  viaDiameter: number
  layerCount: number
  solved: boolean
  failed: boolean
  /** The benchmark relaxed trace/via edge clearance is 0.1 mm. */
  clearance?: number
}

const EPSILON = 1e-6

const pointDistance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

const pointSegmentDistance = (p: { x: number; y: number }, a: Point, b: Point): number => {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1,
    ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

const segmentDistance = (a: Point, b: Point, c: Point, d: Point): number => {
  const cross = (p: Point, q: Point, r: Point): number =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  const o1 = cross(a, b, c)
  const o2 = cross(a, b, d)
  const o3 = cross(c, d, a)
  const o4 = cross(c, d, b)
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

/**
 * Structural checks and physical copper diagnostics for an accepted node result.
 * Call AFTER grow/shrink has mapped coordinates back to the physical node.
 * This deliberately does not return a `drcPassed` field: there are no pads,
 * preloaded traces, neighboring nodes, or final board connectivity in this input.
 */
export const evaluateNodeQuality = (input: NodeQualityInput) => {
  const { node, routes, traceWidth, viaDiameter, layerCount, solved, failed } = input
  const clearance = input.clearance ?? 0.1
  if (!node.portPointsInPairs) throw new Error("Node quality requires explicit port-point pairs")
  if (![traceWidth, viaDiameter, clearance].every(Number.isFinite)) {
    throw new Error("Node quality requires finite physical dimensions")
  }
  const structuralIssues: string[] = []
  const segments: Segment[][] = []
  let traceLengthMm = 0
  let invalidPointCount = 0
  let invalidLayerCount = 0
  let missingViaTransitionCount = 0
  let nonverticalLayerTransitionCount = 0
  let maxCenterlineOutsideNodeMm = 0
  let traceWidthsPreserved = true
  let viaDiametersPreserved = true
  const routeWidths: number[] = []
  const routeViaDiameters: number[] = []
  for (const route of routes) {
    const routeSegments: Segment[] = []
    routeWidths.push(route.traceThickness)
    routeViaDiameters.push(route.viaDiameter)
    if (!Number.isFinite(route.traceThickness) || Math.abs(route.traceThickness - traceWidth) > EPSILON) {
      traceWidthsPreserved = false
    }
    if (!Number.isFinite(route.viaDiameter) || Math.abs(route.viaDiameter - viaDiameter) > EPSILON) {
      viaDiametersPreserved = false
    }
    if (route.route.length < 2) structuralIssues.push(`Short route: ${route.connectionName}`)
    for (let i = 0; i < route.route.length; i++) {
      const point = route.route[i]
      if (![point.x, point.y, point.z].every(Number.isFinite)) invalidPointCount++
      if (!Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount) invalidLayerCount++
      if (point.traceThickness !== undefined &&
        (!Number.isFinite(point.traceThickness) || Math.abs(point.traceThickness - traceWidth) > EPSILON)) {
        traceWidthsPreserved = false
      }
      maxCenterlineOutsideNodeMm = Math.max(maxCenterlineOutsideNodeMm,
        Math.abs(point.x - node.center.x) - node.width / 2,
        Math.abs(point.y - node.center.y) - node.height / 2)
      if (i === 0) continue
      const previous = route.route[i - 1]
      if (point.z !== previous.z) {
        if (pointDistance(point, previous) > EPSILON) nonverticalLayerTransitionCount++
        if (!route.vias.some((via) => pointDistance(via, point) <= EPSILON &&
          pointDistance(via, previous) <= EPSILON)) missingViaTransitionCount++
      } else {
        traceLengthMm += pointDistance(point, previous)
        routeSegments.push({ a: previous, b: point,
          width: Math.max(previous.traceThickness ?? route.traceThickness,
            point.traceThickness ?? route.traceThickness) })
      }
    }
    for (const via of route.vias) {
      if (![via.x, via.y].every(Number.isFinite)) invalidPointCount++
    }
    segments.push(routeSegments)
  }
  const matches = (point: Point, terminal: Terminal): boolean =>
    point.z === terminal.z && pointDistance(point, terminal) <= EPSILON
  const unmatchedPairNames: string[] = []
  for (const [start, end] of node.portPointsInPairs) {
    const matched = routes.some((route) => {
      if (route.connectionName !== start.connectionName || route.route.length < 2) return false
      const first = route.route[0]
      const last = route.route[route.route.length - 1]
      return (matches(first, start) && matches(last, end)) ||
        (matches(first, end) && matches(last, start))
    })
    if (!matched) unmatchedPairNames.push(start.connectionName)
  }
  if (!solved || failed) structuralIssues.push("Solver did not finish successfully")
  if (routes.length !== node.portPointsInPairs.length) structuralIssues.push("Route count differs from requested pair count")
  if (unmatchedPairNames.length) structuralIssues.push("Not every requested pair has a route joining its two terminals")
  if (!traceWidthsPreserved) structuralIssues.push("Physical trace widths changed")
  if (!viaDiametersPreserved) structuralIssues.push("Physical via diameters changed")
  if (invalidPointCount) structuralIssues.push("Non-finite route or via coordinates")
  if (invalidLayerCount) structuralIssues.push("Invalid layer indexes")
  if (missingViaTransitionCount) structuralIssues.push("Layer transition missing a via at the transition point")
  if (nonverticalLayerTransitionCount) structuralIssues.push("Layer transition changes x/y coordinates")

  // These counts intentionally represent route pairs or via/route pairs,
  // rather than the number of adjacent polyline segments reported by DRC.
  let tracePairClearanceViolations = 0
  let tracePairCopperOverlaps = 0
  let viaTracePairClearanceViolations = 0
  let viaPairClearanceViolations = 0
  let minTraceEdgeGapMm = Infinity
  let minViaTraceEdgeGapMm = Infinity
  let minViaEdgeGapMm = Infinity
  const netName = (route: Route): string => route.rootConnectionName ?? route.connectionName
  for (let i = 0; i < routes.length; i++) {
    for (let j = i + 1; j < routes.length; j++) {
      if (netName(routes[i]) === netName(routes[j])) continue
      let nearest = Infinity
      for (const a of segments[i]) for (const b of segments[j]) {
        if (a.a.z !== b.a.z) continue
        nearest = Math.min(nearest, segmentDistance(a.a, a.b, b.a, b.b) - (a.width + b.width) / 2)
      }
      minTraceEdgeGapMm = Math.min(minTraceEdgeGapMm, nearest)
      if (nearest < clearance - EPSILON) tracePairClearanceViolations++
      if (nearest < -EPSILON) tracePairCopperOverlaps++
    }
  }
  const vias = routes.flatMap((route, routeIndex) => route.vias.map((via) =>
    ({ ...via, routeIndex, diameter: route.viaDiameter, net: netName(route) })))
  for (const via of vias) {
    for (let i = 0; i < routes.length; i++) {
      if (via.net === netName(routes[i])) continue
      let nearest = Infinity
      // Input vias have no layer span. Treat them as through vias across all
      // layers, matching this two-layer sample; do not use for blind-via boards.
      for (const segment of segments[i]) nearest = Math.min(nearest,
        pointSegmentDistance(via, segment.a, segment.b) - (via.diameter + segment.width) / 2)
      minViaTraceEdgeGapMm = Math.min(minViaTraceEdgeGapMm, nearest)
      if (nearest < clearance - EPSILON) viaTracePairClearanceViolations++
    }
  }
  for (let i = 0; i < vias.length; i++) for (let j = i + 1; j < vias.length; j++) {
    const distance = pointDistance(vias[i], vias[j])
    // Coincident same-net vias are represented once by the final converter.
    if (distance <= EPSILON && vias[i].net === vias[j].net) continue
    const gap = distance - (vias[i].diameter + vias[j].diameter) / 2
    minViaEdgeGapMm = Math.min(minViaEdgeGapMm, gap)
    if (gap < clearance - EPSILON) viaPairClearanceViolations++
  }
  const canonicalNumber = (value: number): number | string =>
    Number.isFinite(value) ? Math.round(value * 1e8) / 1e8 : String(value)
  const geometry = routes.map((route) => JSON.stringify({
    connectionName: route.connectionName, rootConnectionName: route.rootConnectionName,
    traceThickness: canonicalNumber(route.traceThickness), viaDiameter: canonicalNumber(route.viaDiameter),
    route: route.route.map((p) => [canonicalNumber(p.x), canonicalNumber(p.y), canonicalNumber(p.z),
      canonicalNumber(p.traceThickness ?? route.traceThickness)]),
    vias: route.vias.map((p) => [canonicalNumber(p.x), canonicalNumber(p.y)])
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  })).sort()
  return {
    scope: "physical-node diagnostic; not final-board DRC" as const,
    structuralChecksPassed: structuralIssues.length === 0,
    structuralIssues,
    geometryFingerprint: createHash("sha256").update(JSON.stringify(geometry)).digest("hex"),
    fingerprintCoordinatePrecisionMm: 1e-8,
    routeCount: routes.length,
    expectedPairCount: node.portPointsInPairs.length,
    matchedPairCount: node.portPointsInPairs.length - unmatchedPairNames.length,
    unmatchedPairNames,
    viaCount: vias.length,
    traceLengthMm,
    traceWidthsPreserved,
    viaDiametersPreserved,
    traceWidthsMm: [...new Set(routeWidths)].sort((a, b) => a - b),
    viaDiametersMm: [...new Set(routeViaDiameters)].sort((a, b) => a - b),
    maxCenterlineOutsideNodeMm,
    invalidPointCount,
    invalidLayerCount,
    missingViaTransitionCount,
    nonverticalLayerTransitionCount,
    localCopperDiagnostics: {
      assumedThroughVias: true,
      clearanceMm: clearance,
      tracePairClearanceViolations,
      tracePairCopperOverlaps,
      viaTracePairClearanceViolations,
      viaPairClearanceViolations,
      minTraceEdgeGapMm: Number.isFinite(minTraceEdgeGapMm) ? minTraceEdgeGapMm : null,
      minViaTraceEdgeGapMm: Number.isFinite(minViaTraceEdgeGapMm) ? minViaTraceEdgeGapMm : null,
      minViaEdgeGapMm: Number.isFinite(minViaEdgeGapMm) ? minViaEdgeGapMm : null,
    },
  }
}

export type NodeQualityResult = ReturnType<typeof evaluateNodeQuality>
