import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

type Point = { x: number; y: number; layer: string }
type Segment = { a: Point; b: Point }
type Connectivity = { connectedNets: number; connectedEndpoints: number }

/** Check the original terminals against emitted copper, including clock branches. */
export function getEndpointConnectivity(
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
): Connectivity {
  let connectedNets = 0
  let connectedEndpoints = 0
  const layers = [
    "top",
    ...Array.from(
      { length: srj.layerCount - 2 },
      (_, z): string => `inner${z + 1}`,
    ),
    "bottom",
  ]
  for (const connection of srj.connections) {
    const parent = new Map<string, string>()
    const find = (id: string): string => {
      const previous = parent.get(id)
      if (previous === undefined) {
        parent.set(id, id)
        return id
      }
      if (previous === id) return id
      const root = find(previous)
      parent.set(id, root)
      return root
    }
    const union = (a: Point, b: Point): void => {
      const aKey = `${a.x.toFixed(6)},${a.y.toFixed(6)},${a.layer}`
      const bKey = `${b.x.toFixed(6)},${b.y.toFixed(6)},${b.layer}`
      const aRoot = find(aKey)
      const bRoot = find(bKey)
      if (aRoot === bRoot) return
      parent.set(aRoot, bRoot)
    }
    const segments: Segment[] = []
    const onSegment = (point: Point, segment: Segment): boolean => {
      if (point.layer !== segment.a.layer) return false
      const dx = segment.b.x - segment.a.x
      const dy = segment.b.y - segment.a.y
      const lengthSquared = dx * dx + dy * dy
      if (lengthSquared < 1e-18)
        return Math.hypot(point.x - segment.a.x, point.y - segment.a.y) < 1e-6
      const t =
        ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) /
        lengthSquared
      return (
        t >= -1e-7 &&
        t <= 1 + 1e-7 &&
        Math.hypot(
          point.x - segment.a.x - t * dx,
          point.y - segment.a.y - t * dy,
        ) < 1e-6
      )
    }
    for (const trace of traces) {
      if (
        trace.connection_name !== connection.name &&
        !trace.connection_name.startsWith(`${connection.name}_mst`)
      )
        continue
      for (let index = 0; index < trace.route.length; index++) {
        const point = trace.route[index]!
        const next = trace.route[index + 1]
        if (point.route_type === "via") {
          const first = layers.indexOf(point.from_layer)
          const last = layers.indexOf(point.to_layer)
          if (first < 0 || last < 0) throw new Error("Unknown via layer")
          for (let z = Math.min(first, last); z <= Math.max(first, last); z++)
            union(
              { x: point.x, y: point.y, layer: point.from_layer },
              { x: point.x, y: point.y, layer: layers[z]! },
            )
        }
        if (
          point.route_type === "wire" &&
          next?.route_type === "wire" &&
          point.layer === next.layer
        ) {
          const a = { x: point.x, y: point.y, layer: point.layer }
          const b = { x: next.x, y: next.y, layer: next.layer }
          union(a, b)
          segments.push({ a, b })
        }
      }
    }
    const terminals = connection.pointsToConnect.map(
      (point): Point => ({
        x: point.x,
        y: point.y,
        layer: point.layer ?? point.layers![0]!,
      }),
    )
    for (const point of [
      ...segments.flatMap(({ a, b }): Point[] => [a, b]),
      ...terminals,
    ])
      for (const segment of segments)
        if (onSegment(point, segment)) union(point, segment.a)
    const roots = terminals.map((point): string =>
      find(`${point.x.toFixed(6)},${point.y.toFixed(6)},${point.layer}`),
    )
    if (
      roots.length >= 2 &&
      roots.every((root): boolean => root === roots[0])
    ) {
      connectedNets++
      connectedEndpoints += terminals.length
    }
  }
  return { connectedNets, connectedEndpoints }
}
