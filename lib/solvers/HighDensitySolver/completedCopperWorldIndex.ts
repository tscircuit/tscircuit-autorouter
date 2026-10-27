import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { RbushIndex } from "lib/data-structures/RbushIndex"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

type Point = { x: number; y: number }
export type CompletedCopperBounds = { minX: number; minY: number; maxX: number; maxY: number }
type Identity = Pick<HighDensityRoute, "connectionName" | "rootConnectionName">
export type CompletedCopperWorldFeature =
  | { readonly kind: "wire"; readonly route: HighDensityRoute; readonly start: Point; readonly end: Point; readonly z: number; readonly width: number }
  | { readonly kind: "via"; readonly route: HighDensityRoute; readonly center: Point; readonly minZ: number; readonly maxZ: number; readonly diameter: number; readonly holeDiameter: number }

export type CompletedCopperWorldOptions = {
  layerCount: number
  allowBlindAndBuriedVias?: boolean
  traceClearance?: number
  viaHoleDiameter?: number
  minViaHoleEdgeToViaHoleEdgeClearance?: number
}

/** Consumers can query committed WORLD copper but cannot append to its ledger. */
export interface RoutedPeerWorldIndex {
  readonly layerCount: number
  readonly allowBlindAndBuriedVias: boolean
  readonly traceClearance: number
  readonly viaHoleDiameter?: number
  readonly minViaHoleEdgeToViaHoleEdgeClearance: number
  query(bounds: CompletedCopperBounds): readonly CompletedCopperWorldFeature[]
}

type Transform = { center?: Point; coordinateScale?: number }
const EPSILON = 1e-9
const MINIMUM_VIA_EDGE_CLEARANCE = 0.1

function owner(route: Identity, connMap?: ConnectivityMap): string {
  const registered = (key: string): boolean =>
    connMap !== undefined && Object.prototype.propertyIsEnumerable.call(connMap.netMap, key)
  if (route.rootConnectionName !== undefined && registered(route.rootConnectionName)) {
    return JSON.stringify(["registered", route.rootConnectionName])
  }
  if (registered(route.connectionName)) return JSON.stringify(["registered", route.connectionName])
  const direct = connMap?.getNetConnectedToId(route.connectionName)
  if (direct !== undefined) return JSON.stringify(["registered", direct])
  const root = route.rootConnectionName ?? route.connectionName
  const net = registered(root) ? root : connMap?.getNetConnectedToId(root)
  return JSON.stringify(net === undefined ? ["literal", root] : ["registered", net])
}

/** Registered root keys take precedence over colliding display aliases. */
export function areCopperRoutesOnSameNet(a: Identity, b: Identity, connMap?: ConnectivityMap): boolean {
  return owner(a, connMap) === owner(b, connMap)
}

function nonnegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid completed-copper ${label}`)
  return value
}

function metal(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid completed-copper ${label}`)
  return value
}

function worldTransform({ center = { x: 0, y: 0 }, coordinateScale = 1 }: Transform): (point: Point) => Point {
  metal(coordinateScale, "coordinate scale")
  return (point): Point => {
    const transformed = { x: center.x + (point.x - center.x) / coordinateScale,
      y: center.y + (point.y - center.y) / coordinateScale }
    if (!Number.isFinite(transformed.x) || !Number.isFinite(transformed.y)) throw new Error("Invalid completed-copper coordinate")
    return transformed
  }
}

function featuresForRoutes(routes: readonly HighDensityRoute[], index: RoutedPeerWorldIndex, transform: Transform): CompletedCopperWorldFeature[] {
  const world = worldTransform(transform), features: CompletedCopperWorldFeature[] = []
  for (const route of routes) {
    const geometry = getPipeline9RouteCopperGeometry(route, index)
    for (const wire of geometry.wireSegments) {
      features.push({ kind: "wire", route, start: world(wire.start), end: world(wire.end), z: wire.z, width: metal(wire.width, "trace width") })
    }
    // Endpoint disks also cover zero-length routes and rounded grid starts.
    for (const point of route.route) {
      if (!Number.isInteger(point.z) || point.z < 0 || point.z >= index.layerCount) throw new Error("Invalid completed-copper layer")
      const p = world(point)
      features.push({ kind: "wire", route, start: p, end: p, z: point.z, width: metal(point.traceThickness ?? route.traceThickness, "endpoint width") })
    }
    for (const via of geometry.viaSpans) {
      features.push({ kind: "via", route, center: world(via.center), minZ: via.minZ, maxZ: via.maxZ,
        diameter: metal(via.diameter, "via diameter"), holeDiameter: metal(index.viaHoleDiameter ?? via.diameter, "via hole diameter") })
    }
  }
  return features
}

function bounds(feature: CompletedCopperWorldFeature, extra = 0): CompletedCopperBounds {
  if (feature.kind === "wire") {
    const radius = feature.width / 2 + extra
    return { minX: Math.min(feature.start.x, feature.end.x) - radius, maxX: Math.max(feature.start.x, feature.end.x) + radius,
      minY: Math.min(feature.start.y, feature.end.y) - radius, maxY: Math.max(feature.start.y, feature.end.y) + radius }
  }
  const radius = Math.max(feature.diameter, feature.holeDiameter) / 2 + extra
  return { minX: feature.center.x - radius, maxX: feature.center.x + radius, minY: feature.center.y - radius, maxY: feature.center.y + radius }
}

function conflicts(a: CompletedCopperWorldFeature, b: CompletedCopperWorldFeature, index: RoutedPeerWorldIndex, connMap?: ConnectivityMap): boolean {
  const sameNet = areCopperRoutesOnSameNet(a.route, b.route, connMap)
  if (a.kind === "wire" && b.kind === "wire") {
    return !sameNet && a.z === b.z && minimumDistanceBetweenSegments(a.start, a.end, b.start, b.end) + EPSILON <
      a.width / 2 + b.width / 2 + index.traceClearance
  }
  if (a.kind === "via" && b.kind === "via") {
    if (a.maxZ < b.minZ || b.maxZ < a.minZ) return false
    const distance = Math.hypot(a.center.x - b.center.x, a.center.y - b.center.y)
    if (sameNet && distance <= EPSILON && a.minZ === b.minZ && a.maxZ === b.maxZ &&
      Math.abs(a.diameter - b.diameter) <= EPSILON && Math.abs(a.holeDiameter - b.holeDiameter) <= EPSILON) return false
    const margin = Math.max(a.diameter / 2 + b.diameter / 2 + MINIMUM_VIA_EDGE_CLEARANCE,
      a.holeDiameter / 2 + b.holeDiameter / 2 + index.minViaHoleEdgeToViaHoleEdgeClearance)
    return distance + EPSILON < margin
  }
  const wire = a.kind === "wire" ? a : b as Extract<CompletedCopperWorldFeature, { kind: "wire" }>
  const via = a.kind === "via" ? a : b as Extract<CompletedCopperWorldFeature, { kind: "via" }>
  return !sameNet && wire.z >= via.minZ && wire.z <= via.maxZ &&
    minimumDistanceBetweenSegments(wire.start, wire.end, via.center, via.center) + EPSILON <
      wire.width / 2 + via.diameter / 2 + index.traceClearance
}

/** Per-P9 owner; new copper is not registered as mutable preloaded trace data. */
export class CompletedCopperWorldIndex implements RoutedPeerWorldIndex {
  readonly layerCount: number
  readonly allowBlindAndBuriedVias: boolean
  readonly traceClearance: number
  readonly viaHoleDiameter?: number
  readonly minViaHoleEdgeToViaHoleEdgeClearance: number
  private readonly tree = new RbushIndex<CompletedCopperWorldFeature>()

  constructor(options: CompletedCopperWorldOptions) {
    if (!Number.isInteger(options.layerCount) || options.layerCount < 1) throw new Error("Invalid completed-copper board layer count")
    this.layerCount = options.layerCount
    this.allowBlindAndBuriedVias = options.allowBlindAndBuriedVias ?? false
    this.traceClearance = nonnegative(options.traceClearance ?? 0.1, "trace clearance")
    this.viaHoleDiameter = options.viaHoleDiameter === undefined ? undefined : metal(options.viaHoleDiameter, "via hole diameter")
    this.minViaHoleEdgeToViaHoleEdgeClearance = nonnegative(options.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1, "via hole clearance")
  }

  addRoutes(routes: readonly HighDensityRoute[], transform: Transform = {}): void {
    const features = featuresForRoutes(routes, this, transform)
    for (const feature of features) {
      const box = bounds(feature)
      this.tree.insert(feature, box.minX, box.minY, box.maxX, box.maxY)
    }
  }

  query(box: CompletedCopperBounds): readonly CompletedCopperWorldFeature[] {
    return this.tree.search(box.minX, box.minY, box.maxX, box.maxY)
  }
}

export function createRoutedPeerWorldIndex(options: CompletedCopperWorldOptions): CompletedCopperWorldIndex {
  return new CompletedCopperWorldIndex(options)
}

export function queryCompletedCopperWorldIndex(index: RoutedPeerWorldIndex, box: CompletedCopperBounds): readonly CompletedCopperWorldFeature[] {
  return index.query(box)
}

/** Candidate copper is converted to WORLD once; stored peer coordinates never move. */
export function areRoutesClearOfCompletedCopper(params: {
  routes: readonly HighDensityRoute[]
  routedPeerWorldIndex?: RoutedPeerWorldIndex
  connMap?: ConnectivityMap
  center?: Point
  coordinateScale?: number
}): boolean {
  const index = params.routedPeerWorldIndex
  if (!index) return true
  const features = featuresForRoutes(params.routes, index, params)
  const queryMargin = Math.max(index.traceClearance, MINIMUM_VIA_EDGE_CLEARANCE, index.minViaHoleEdgeToViaHoleEdgeClearance)
  for (let i = 0; i < features.length; i++) {
    const feature = features[i]!
    for (const peer of index.query(bounds(feature, queryMargin))) {
      if (conflicts(feature, peer, index, params.connMap)) return false
    }
    for (let j = 0; j < i; j++) {
      if (conflicts(feature, features[j]!, index, params.connMap)) return false
    }
  }
  return true
}
