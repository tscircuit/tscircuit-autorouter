import type {
  Obstacle,
  SimpleRouteJson,
  SimplifiedPcbTrace as Trace,
} from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"

type Wire = Extract<Trace["route"][number], { route_type: "wire" }>
type Pin = {
  pad: Obstacle
  trace: Trace
  port: Wire
  remote: Wire
  remoteFirst: boolean
}
type Search = (
  trace: Trace,
  start: Wire,
  end: Wire,
  fixed: Trace[],
  allowVias: boolean,
  reverse?: boolean,
) => Trace["route"] | undefined

/** Reserve adjacent pad exits together before reconnecting their remote terminals. */
export function* getPinRowEscapeCandidates(
  input: SimpleRouteJson,
  traces: Trace[],
  target: Trace,
  eligible: (trace: Trace) => boolean,
  search: Search,
): Generator<Trace[]> {
  const pads = input.obstacles.filter(
    (pad) =>
      pad.componentId &&
      pad.layers.length === 1 &&
      !pad.ccwRotationDegrees &&
      !pad.isCopperPour &&
      pad.type === "rect" &&
      pad.width !== pad.height,
  )
  const ends = new Map<Obstacle, Pin>()
  for (const trace of traces) {
    if (!eligible(trace)) continue
    const start = trace.route[0]
    const end = trace.route.at(-1)
    if (start?.route_type !== "wire" || end?.route_type !== "wire") continue
    for (const [port, remote] of [[start, end], [end, start]] as const) {
      const pad = pads.find(
        (p) => p.layers[0] === port.layer && p.center.x === port.x && p.center.y === port.y,
      )
      if (pad) ends.set(pad, { pad, trace, port, remote, remoteFirst: port === end })
    }
  }

  for (const selected of ends.values()) {
    if (selected.trace !== target) continue
    const { pad } = selected
    const horizontal = pad.width > pad.height
    const normal = horizontal ? "x" : "y"
    const tangent = horizontal ? "y" : "x"
    const componentPads = pads.filter((p) => p.componentId === pad.componentId)
    const sidePads = componentPads
      .filter((p) =>
        p.layers[0] === pad.layers[0] &&
        p.width === pad.width &&
        p.height === pad.height &&
        p.center[normal] === pad.center[normal],
      )
      .sort((a, b) => a.center[tangent] - b.center[tangent])

    // Only the contiguous run containing the pad involved in the violation moves.
    const pins: Pin[] = []
    for (const p of sidePads) {
      const pin = ends.get(p)
      if (pin) pins.push(pin)
      else if (pins.includes(selected)) break
      else pins.length = 0
    }
    if (!pins.includes(selected) || pins.length < 2 || pins.length > 8) continue
    const pitch = pins[1]!.port[tangent] - pins[0]!.port[tangent]
    const isUniform = pins.slice(1).every((p, i) =>
      Math.abs(p.port[tangent] - pins[i]!.port[tangent] - pitch) <= 0.01 * pitch,
    )
    if (pitch <= 0 || !isUniform) continue
    const middle = componentPads.reduce((s, p) => s + p.center[normal], 0) / componentPads.length
    const sign = Math.sign(pad.center[normal] - middle)
    const escapeLength = 20 * pitch
    if (!sign || pins.some((p) => sign * (p.remote[normal] - p.port[normal]) < escapeLength)) continue

    // Connect the middle lanes first, leaving via clearance at the outer ends.
    const centerIndex = (pins.length - 1) / 2
    const order = pins.map((_, i) => i).sort((a, b) => Math.abs(a - centerIndex) - Math.abs(b - centerIndex))
    const viaPitch = getViaDimensions(input).padDiameter + input.minTraceToPadEdgeClearance!
    const spread = Math.max(0, viaPitch - pitch)
    const fixed = traces.filter((t) => !pins.some((p) => p.trace === t))
    for (const bend of [0, 1, -1]) {
      const stubs = pins.map((p, i) => {
        const point = (distance: number, offset: number): Wire => ({
          route_type: "wire",
          layer: p.port.layer,
          width: p.port.width,
          x: p.port.x,
          y: p.port.y,
          [normal]: p.port[normal] + sign * distance,
          [tangent]: p.port[tangent] + offset,
        })
        const shift = bend * 2.5 * pitch
        return [
          p.port,
          point(Math.max(pad.width, pad.height) / 2, 0),
          point(4 * pitch, shift),
          point(10 * pitch, shift),
          point(escapeLength, shift + (i - Math.floor(pins.length / 2)) * spread),
        ]
      })
      const segments = pins.map((p, i) => ({ ...p.trace, route: stubs[i]! }))
      const replacements = new Map<Trace, Trace>()
      for (const i of order) {
        const p = pins[i]!
        const stub = stubs[i]!
        const obstacles = [...fixed, ...segments.filter((_, j) => j !== i), ...replacements.values()]
        const route = search(p.trace, p.remote, stub.at(-1)!, obstacles, p.trace.route.some((w) => w.route_type === "via"), true)
        if (!route) break
        let joined = [...route, ...stub.slice(0, -1).reverse()]
        if (!p.remoteFirst) {
          joined = joined.reverse().map((w) => w.route_type === "via"
            ? { ...w, from_layer: w.to_layer, to_layer: w.from_layer }
            : w,
          )
        }
        replacements.set(p.trace, { ...p.trace, route: joined })
      }
      if (replacements.size === pins.length) yield traces.map((t) => replacements.get(t) ?? t)
    }
  }
}
