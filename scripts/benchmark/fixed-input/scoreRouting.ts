import type {
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../../lib/types/srj-types"

type Point = { x: number; y: number }
type Copper = {
  id: string
  net: string | undefined
  layers: string[]
  kind: "pad" | "keepout" | "wire" | "via"
} & (
  | { shape: "rect"; minX: number; maxX: number; minY: number; maxY: number }
  | { shape: "capsule"; a: Point; b: Point; radius: number }
)
export type RoutingViolation = { type: string; first: string; second?: string }
export type RoutingScore = {
  connectedConnections: number
  totalConnections: number
  unconnectedConnectionNames: string[]
  drcViolationCount: number
  violations: RoutingViolation[]
  traceLengthMm: number
  viaCount: number
  valid: boolean
  evaluatorLimitations: string[]
}

// All distances are millimeters in the SRJ board frame (x right, y up).
// Two DSN coordinate quanta absorb endpoint rounding; both engines use this tolerance.
const epsilon = 0.000002

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  const ratio =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
          ),
        )
  return Math.hypot(point.x - a.x - ratio * dx, point.y - a.y - ratio * dy)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const abX = b.x - a.x
  const abY = b.y - a.y
  const cdX = d.x - c.x
  const cdY = d.y - c.y
  const determinant = abX * cdY - abY * cdX
  if (determinant !== 0) {
    const t = ((c.x - a.x) * cdY - (c.y - a.y) * cdX) / determinant
    const u = ((c.x - a.x) * abY - (c.y - a.y) * abX) / determinant
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0
  }
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  )
}

function copperDistance(first: Copper, second: Copper): number {
  if (first.shape === "capsule" && second.shape === "capsule")
    return (
      segmentDistance(first.a, first.b, second.a, second.b) -
      first.radius -
      second.radius
    )
  if (first.shape === "rect" && second.shape === "rect") {
    const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX)
    const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY)
    return Math.hypot(dx, dy)
  }
  const rectangle = first.shape === "rect" ? first : second
  const capsule = first.shape === "capsule" ? first : second
  if (rectangle.shape !== "rect" || capsule.shape !== "capsule")
    throw new Error("Invalid copper geometry pair")
  for (const point of [capsule.a, capsule.b]) {
    if (
      point.x >= rectangle.minX &&
      point.x <= rectangle.maxX &&
      point.y >= rectangle.minY &&
      point.y <= rectangle.maxY
    )
      return -capsule.radius
  }
  const corners = [
    { x: rectangle.minX, y: rectangle.minY },
    { x: rectangle.maxX, y: rectangle.minY },
    { x: rectangle.maxX, y: rectangle.maxY },
    { x: rectangle.minX, y: rectangle.maxY },
  ]
  return (
    Math.min(
      ...corners.map((corner, index) =>
        segmentDistance(capsule.a, capsule.b, corner, corners[(index + 1) % 4]),
      ),
    ) - capsule.radius
  )
}

function findRoot(parents: number[], index: number): number {
  let root = index
  while (parents[root] !== root) root = parents[root]
  while (parents[index] !== index) {
    const next = parents[index]
    parents[index] = root
    index = next
  }
  return root
}

/** Score actual copper contact, independent of solver flags and connection labels.
 * Each same-net touching copper component is joined physically; net membership
 * alone never joins separate branches. A two-layer pad joins its copper layers.
 * Input/input DRC is excluded: this measures violations introduced by routing.
 */
export function scoreRouting(
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
): RoutingScore {
  const copper: Copper[] = srj.obstacles.map((obstacle, index) => ({
    id: obstacle.obstacleId ?? `obstacle_${index}`,
    net: obstacle.connectedTo[0],
    layers: obstacle.layers,
    kind: obstacle.connectedTo.length ? "pad" : "keepout",
    shape: "rect",
    minX: obstacle.center.x - obstacle.width / 2,
    maxX: obstacle.center.x + obstacle.width / 2,
    minY: obstacle.center.y - obstacle.height / 2,
    maxY: obstacle.center.y + obstacle.height / 2,
  }))
  const obstacleCount = copper.length
  const violations: RoutingViolation[] = []
  const names = new Set(srj.connections.map((connection) => connection.name))
  const viaKeys = new Set<string>()
  let traceLengthMm = 0
  for (const trace of traces) {
    if (!names.has(trace.connection_name))
      throw new Error(
        `Output trace ${trace.pcb_trace_id} has unknown connection ${trace.connection_name}`,
      )
    if (trace.route.length === 0)
      throw new Error(`Empty output trace ${trace.pcb_trace_id}`)
    for (const [index, point] of trace.route.entries()) {
      const id = `${trace.pcb_trace_id}:${index}`
      if (point.route_type === "jumper")
        throw new Error(
          "Jumper output is unsupported by the fixed-input benchmark",
        )
      if (point.route_type === "through_obstacle") {
        const matchingPad = copper
          .slice(0, obstacleCount)
          .find(
            (pad) =>
              pad.kind === "pad" &&
              pad.net === trace.connection_name &&
              pad.shape === "rect" &&
              pad.layers.includes(point.from_layer) &&
              pad.layers.includes(point.to_layer) &&
              [point.start, point.end].every(
                (p) =>
                  p.x >= pad.minX - epsilon &&
                  p.x <= pad.maxX + epsilon &&
                  p.y >= pad.minY - epsilon &&
                  p.y <= pad.maxY + epsilon,
              ),
          )
        if (!matchingPad)
          violations.push({ type: "invalid_through_pad_transition", first: id })
        continue
      }
      if (![point.x, point.y].every(Number.isFinite))
        throw new Error(`Nonfinite output coordinates in ${id}`)
      if (point.route_type === "via") {
        if (
          ![point.from_layer, point.to_layer].every(
            (layer) => layer === "top" || layer === "bottom",
          ) ||
          point.from_layer === point.to_layer
        )
          throw new Error(`Unsupported via span in ${id}`)
        const diameter = point.via_diameter ?? srj.minViaPadDiameter
        const holeDiameter = point.via_hole_diameter ?? srj.minViaHoleDiameter
        if (
          diameter === undefined ||
          holeDiameter === undefined ||
          !Number.isFinite(diameter) ||
          !Number.isFinite(holeDiameter) ||
          diameter <= 0 ||
          holeDiameter <= 0
        )
          throw new Error(`Invalid via dimensions in ${id}`)
        if (
          Math.abs(diameter - srj.minViaPadDiameter!) > epsilon ||
          Math.abs(holeDiameter - srj.minViaHoleDiameter!) > epsilon
        )
          violations.push({ type: "via_dimensions", first: id })
        const key = `${trace.connection_name}:${point.x}:${point.y}`
        if (!viaKeys.has(key)) {
          copper.push({
            id,
            net: trace.connection_name,
            layers: ["top", "bottom"],
            kind: "via",
            shape: "capsule",
            a: point,
            b: point,
            radius: diameter / 2,
          })
          viaKeys.add(key)
        }
      } else {
        if (
          !Number.isFinite(point.width) ||
          point.width <= 0 ||
          (point.layer !== "top" && point.layer !== "bottom")
        )
          throw new Error(`Unsupported wire geometry in ${id}`)
        if (Math.abs(point.width - srj.minTraceWidth) > epsilon)
          violations.push({ type: "trace_width", first: id })
        copper.push({
          id,
          net: trace.connection_name,
          layers: [point.layer],
          kind: "wire",
          shape: "capsule",
          a: point,
          b: point,
          radius: point.width / 2,
        })
      }
      const next = trace.route[index + 1]
      if (
        !next ||
        next.route_type === "jumper" ||
        next.route_type === "through_obstacle"
      )
        continue
      let layer: string | undefined
      let width: number | undefined
      if (point.route_type === "wire" && next.route_type === "wire") {
        if (point.layer === next.layer) {
          layer = point.layer
          width = point.width
        } else
          violations.push({ type: "wire_layer_change_without_via", first: id })
      } else if (
        point.route_type === "wire" &&
        next.route_type === "via" &&
        point.layer === next.from_layer
      ) {
        layer = point.layer
        width = point.width
      } else if (
        point.route_type === "via" &&
        next.route_type === "wire" &&
        point.to_layer === next.layer
      ) {
        layer = next.layer
        width = next.width
      } else if (Math.hypot(point.x - next.x, point.y - next.y) > epsilon)
        violations.push({ type: "invalid_route_transition", first: id })
      if (layer && width !== undefined) {
        copper.push({
          id: `${id}:segment`,
          net: trace.connection_name,
          layers: [layer],
          kind: "wire",
          shape: "capsule",
          a: point,
          b: next,
          radius: width / 2,
        })
        traceLengthMm += Math.hypot(point.x - next.x, point.y - next.y)
      }
    }
  }
  const parents = copper.map((_, index) => index)
  for (let i = 0; i < copper.length; i++) {
    const first = copper[i]
    if (i >= obstacleCount) {
      if (first.shape !== "capsule")
        throw new Error("Unexpected routed copper geometry")
      const edgeDistance =
        Math.min(first.a.x, first.b.x) - first.radius - srj.bounds.minX
      const clearance = Math.min(
        edgeDistance,
        srj.bounds.maxX - Math.max(first.a.x, first.b.x) - first.radius,
        Math.min(first.a.y, first.b.y) - first.radius - srj.bounds.minY,
        srj.bounds.maxY - Math.max(first.a.y, first.b.y) - first.radius,
      )
      if (clearance < srj.minBoardEdgeClearance! - epsilon)
        violations.push({ type: "board_edge_clearance", first: first.id })
    }
    for (let j = 0; j < i; j++) {
      const second = copper[j]
      if (!first.layers.some((layer) => second.layers.includes(layer))) continue
      const distance = copperDistance(first, second)
      const sameNet = first.net !== undefined && first.net === second.net
      if (sameNet && distance <= epsilon)
        parents[findRoot(parents, i)] = findRoot(parents, j)
      if (i < obstacleCount && j < obstacleCount) continue
      if (sameNet) {
        if (
          !srj.allowViaInPad &&
          distance < -epsilon &&
          ((first.kind === "via" && second.kind === "pad") ||
            (first.kind === "pad" && second.kind === "via"))
        )
          violations.push({
            type: "via_in_pad",
            first: first.id,
            second: second.id,
          })
      } else if (distance < srj.defaultObstacleMargin! - epsilon)
        violations.push({
          type: "copper_clearance",
          first: first.id,
          second: second.id,
        })
    }
  }
  const unconnectedConnectionNames: string[] = []
  for (const connection of srj.connections) {
    const roots = new Set<number>()
    for (const point of connection.pointsToConnect) {
      const layers = "layers" in point ? point.layers : [point.layer]
      const padIndices = copper
        .slice(0, obstacleCount)
        .flatMap((pad, index) =>
          pad.net === connection.name &&
          pad.shape === "rect" &&
          Math.abs(point.x - (pad.minX + pad.maxX) / 2) < epsilon &&
          Math.abs(point.y - (pad.minY + pad.maxY) / 2) < epsilon &&
          layers.every((layer) => pad.layers.includes(layer))
            ? [index]
            : [],
        )
      if (padIndices.length !== 1)
        throw new Error(
          `Terminal on ${connection.name} must map to exactly one physical pad`,
        )
      roots.add(findRoot(parents, padIndices[0]))
    }
    if (roots.size !== 1) unconnectedConnectionNames.push(connection.name)
  }
  return {
    connectedConnections:
      srj.connections.length - unconnectedConnectionNames.length,
    totalConnections: srj.connections.length,
    unconnectedConnectionNames,
    drcViolationCount: violations.length,
    violations,
    traceLengthMm,
    viaCount: viaKeys.size,
    valid: unconnectedConnectionNames.length === 0 && violations.length === 0,
    evaluatorLimitations: [
      "Restricted two-layer rectangular-pad benchmark projection; not fabrication DRC.",
      "Checks new copper against input pads/keepouts, new copper, and board edges; does not count pre-existing input/input clearance violations.",
      "No solder-mask, drill-to-drill, annular-ring, impedance, differential-pair, length, or plane-return checks.",
      "Clearance violations count geometry pairs, not unique physical locations; via-in-pad means copper-disk overlap with a pad.",
      "Geometry tolerance is 0.000002 mm; trace length sums output centerline segments without deduplicating overlapping segments.",
    ],
  }
}
