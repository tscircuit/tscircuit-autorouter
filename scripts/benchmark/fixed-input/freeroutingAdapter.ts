import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "../../../lib/types/srj-types"

type SExpression = string | SExpression[]
type Pad = { obstacle: Obstacle; net: string; index: number }

const layerNames: Record<string, string> = { top: "F.Cu", bottom: "B.Cu" }
const sessionLayers: Record<string, string> = { "F.Cu": "top", "B.Cu": "bottom" }
const viaName = "benchmark_via"

/** This projection uses board coordinates in millimeters, x right/y up.
 * DSN coordinates use the same origin/axes, converted to micrometers.
 * A two-layer rectangular pad is one plated pin, electrically joining layers.
 */
export function createFreeroutingDsn(srj: SimpleRouteJson): string {
  const names = new Set(srj.connections.map((connection) => connection.name))
  if (srj.layerCount !== 2 || srj.traces?.length || srj.buses?.length || srj.differentialPairs?.length || srj.outline?.length || srj.jumpers?.length || srj.allowJumpers || srj.allowViaInPad !== false) {
    throw new Error("DSN benchmark supports only two layers, rectangular bounds, no preloads or advanced routing constraints")
  }
  const width = srj.minTraceWidth
  const clearance = srj.defaultObstacleMargin
  const viaDiameter = srj.minViaPadDiameter
  const holeDiameter = srj.minViaHoleDiameter
  if (srj.minViaDiameter !== undefined || srj.min_via_pad_diameter !== undefined || srj.min_via_hole_diameter !== undefined) throw new Error("DSN benchmark requires canonical via dimension fields only")
  if (![width, clearance, viaDiameter, holeDiameter].every((value) => typeof value === "number" && Number.isFinite(value) && value > 0) || srj.nominalTraceWidth !== width || srj.minTraceToPadEdgeClearance !== clearance || srj.minViaEdgeToPadEdgeClearance !== clearance || srj.minBoardEdgeClearance !== clearance || holeDiameter! >= viaDiameter!) {
    throw new Error("DSN benchmark requires explicit uniform widths/clearances and valid via dimensions")
  }
  const pads: Pad[] = []
  for (const [index, obstacle] of srj.obstacles.entries()) {
    if (obstacle.type !== "rect" || obstacle.ccwRotationDegrees || obstacle.isCopperPour || obstacle.netIsAssignable || obstacle.offBoardConnectsTo?.length || obstacle.connectedTo.length > 1 || obstacle.layers.length === 0 || new Set(obstacle.layers).size !== obstacle.layers.length || obstacle.layers.some((layer) => !layerNames[layer]) || ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height].every(Number.isFinite) || obstacle.width <= 0 || obstacle.height <= 0) {
      throw new Error(`Unsupported DSN obstacle ${index}`)
    }
    if (obstacle.connectedTo.length === 1) {
      const net = obstacle.connectedTo[0]
      if (!names.has(net)) throw new Error(`Obstacle ${index} refers to unknown net ${net}`)
      pads.push({ obstacle, net, index })
    }
  }
  for (const connection of srj.connections) {
    if (connection.nominalTraceWidth !== undefined && connection.nominalTraceWidth !== width || connection.isOffBoard || connection.externallyConnectedPointIds?.length || connection.mergedConnectionNames?.length || connection.rootConnectionName && connection.rootConnectionName !== connection.name || connection.netConnectionName && connection.netConnectionName !== connection.name || connection.__netConnectionName && connection.__netConnectionName !== connection.name || connection.__rootConnectionNames?.some((name) => name !== connection.name)) {
      throw new Error(`Unsupported connection constraints on ${connection.name}`)
    }
    const netPads = pads.filter((pad) => pad.net === connection.name)
    const mapped = new Set<number>()
    for (const point of connection.pointsToConnect) {
      const layers = "layers" in point ? point.layers : [point.layer]
      const matches = netPads.filter(({ obstacle }) => Math.abs(point.x - obstacle.center.x) < 1e-9 && Math.abs(point.y - obstacle.center.y) < 1e-9 && layers.length === obstacle.layers.length && layers.every((layer) => obstacle.layers.includes(layer)))
      if (matches.length !== 1 || new Set(layers).size !== layers.length || "terminalVia" in point && point.terminalVia || "busId" in point && point.busId) throw new Error(`Terminal on ${connection.name} must map to exactly one physical pad with identical layers`)
      mapped.add(matches[0].index)
    }
    if (mapped.size !== netPads.length || netPads.length !== connection.pointsToConnect.length || netPads.length < 2) throw new Error(`Net ${connection.name} does not have a one-to-one pad/terminal mapping`)
  }
  const units = (value: number): string => {
    if (!Number.isFinite(value)) {
      throw new Error("Nonfinite DSN coordinate")
    }
    const micrometers = value * 1000
    return String(micrometers)
  }
  const quoted = JSON.stringify
  const b = srj.bounds
  if (![b.minX, b.maxX, b.minY, b.maxY].every(Number.isFinite) || b.minX >= b.maxX || b.minY >= b.maxY || names.size !== srj.connections.length || names.size === 0 || names.has("")) throw new Error("Invalid bounds or duplicate/empty connection names")
  const lines = ['(pcb "fixed_input"', ' (parser (string_quote ") (space_in_quoted_tokens on))', " (resolution um 1000) (unit um)", " (structure", "  (layer F.Cu (type signal) (property (index 0)))", "  (layer B.Cu (type signal) (property (index 1)))", `  (boundary (rect pcb ${units(b.minX)} ${units(b.minY)} ${units(b.maxX)} ${units(b.maxY)}))`, `  (via ${quoted(viaName)})`, `  (rule (width ${units(width)}) (clearance ${units(clearance!)}))`]
  for (const [index, obstacle] of srj.obstacles.entries()) {
    if (obstacle.connectedTo.length !== 0) continue
    for (const layer of obstacle.layers) lines.push(`  (keepout "keepout_${index}_${layer}" (rect ${layerNames[layer]} ${units(obstacle.center.x - obstacle.width / 2)} ${units(obstacle.center.y - obstacle.height / 2)} ${units(obstacle.center.x + obstacle.width / 2)} ${units(obstacle.center.y + obstacle.height / 2)}))`)
  }
  lines.push(" )", " (placement")
  for (const { obstacle, index } of pads) lines.push(`  (component "pad_${index}" (place "pad_${index}" ${units(obstacle.center.x)} ${units(obstacle.center.y)} front 0))`)
  lines.push(" )", " (library")
  for (const { obstacle, index } of pads) {
    lines.push(`  (image "pad_${index}" (pin "padstack_${index}" 1 0 0))`)
    const shapes = obstacle.layers.map((layer) => `(shape (rect ${layerNames[layer]} ${units(-obstacle.width / 2)} ${units(-obstacle.height / 2)} ${units(obstacle.width / 2)} ${units(obstacle.height / 2)}))`).join(" ")
    lines.push(`  (padstack "padstack_${index}" ${shapes} (attach off))`)
  }
  lines.push(`  (padstack ${quoted(viaName)} (shape (circle F.Cu ${units(viaDiameter!)} 0 0)) (shape (circle B.Cu ${units(viaDiameter!)} 0 0)) (attach off))`, " )", " (network")
  for (const connection of srj.connections) lines.push(`  (net ${quoted(connection.name)} (pins ${pads.filter((pad) => pad.net === connection.name).map((pad) => `pad_${pad.index}-1`).join(" ")}))`)
  lines.push(`  (class "benchmark" ${[...names].map((name) => quoted(name)).join(" ")} (circuit (use_via ${quoted(viaName)}) (use_layer F.Cu B.Cu)) (rule (width ${units(width)}) (clearance ${units(clearance!)})))`, " )", " (wiring)", ")")
  return `${lines.join("\n")}\n`
}

function parseSExpressions(text: string): SExpression[] {
  const tokens = text.match(/"(?:\\.|[^"\\])*"|[()]|[^\s()]+/g)
  if (!tokens || tokens.length === 0) throw new Error("Empty Freerouting session")
  const stack: SExpression[][] = []
  let root: SExpression[] | undefined
  for (const token of tokens) {
    if (token === "(") {
      const node: SExpression[] = []
      if (stack.length) stack[stack.length - 1].push(node)
      else if (root) throw new Error("Multiple session roots")
      else root = node
      stack.push(node)
    } else if (token === ")") {
      if (stack.length === 0) throw new Error("Unbalanced session parentheses")
      stack.pop()
    } else {
      if (stack.length === 0) throw new Error("Session token outside root")
      stack[stack.length - 1].push(token.startsWith('"') ? JSON.parse(token) : token)
    }
  }
  if (!root || stack.length || root[0] !== "session") throw new Error("Incomplete or invalid Freerouting session")
  return root
}

function children(node: SExpression[], name: string): SExpression[][] {
  const matches: SExpression[][] = []
  for (const value of node) {
    if (Array.isArray(value) && value[0] === name) matches.push(value)
  }
  return matches
}

function requiredChild(node: SExpression[], name: string): SExpression[] {
  const matches = children(node, name)
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one ${name} in Freerouting session`)
  }
  return matches[0]
}

function numeric(value: SExpression | undefined): number {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Missing numeric session value")
  }
  const number = Number(value)
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric session value: ${value}`)
  }
  return number
}

/** Import all paths and vias without inferring solver success from their presence.
 * SES coordinates divide by resolution * 1000 to recover millimeters.
 */
export function parseFreeroutingSession(session: string, srj: SimpleRouteJson): SimplifiedPcbTrace[] {
  const root = parseSExpressions(session)
  const routes = requiredChild(root, "routes")
  const resolution = requiredChild(routes, "resolution")
  if (resolution[1] !== "um" || numeric(resolution[2]) <= 0) throw new Error("Unsupported session resolution")
  const scale = numeric(resolution[2]) * 1000
  const library = requiredChild(routes, "library_out")
  const padstacks = children(library, "padstack").filter((node) => node[1] === viaName)
  if (padstacks.length !== 1) throw new Error("Session requires exactly one benchmark via padstack")
  const padstack = padstacks[0]
  const shapes = children(padstack, "shape")
  const viaLayers = new Set<string>()
  for (const shape of shapes) {
    const circle = requiredChild(shape, "circle")
    if (typeof circle[1] !== "string" || !sessionLayers[circle[1]] || Math.abs(numeric(circle[2]) / scale - srj.minViaPadDiameter!) > 1e-6 || numeric(circle[3]) !== 0 || numeric(circle[4]) !== 0) throw new Error("Session changed the benchmark via geometry")
    viaLayers.add(circle[1])
  }
  if (shapes.length !== 2 || viaLayers.size !== 2) throw new Error("Session via must span both benchmark layers")
  const network = requiredChild(routes, "network_out")
  if (network.slice(1).some((node) => !Array.isArray(node) || node[0] !== "net")) throw new Error("Unsupported session network item")
  const traces: SimplifiedPcbTrace[] = []
  const names = new Set(srj.connections.map((connection) => connection.name))
  const seen = new Set<string>()
  for (const net of children(network, "net")) {
    const name = net[1]
    if (typeof name !== "string" || !names.has(name) || seen.has(name)) throw new Error(`Unknown or duplicate session net ${name}`)
    seen.add(name)
    for (const item of net.slice(2)) {
      if (!Array.isArray(item)) throw new Error("Malformed session net")
      if (item[0] === "wire") {
        if (item.slice(1).some((node) => !Array.isArray(node) || node[0] !== "path" && node[0] !== "type")) throw new Error("Unsupported session wire item")
        const path = requiredChild(item, "path")
        if (typeof path[1] !== "string" || !sessionLayers[path[1]] || path.length < 7 || (path.length - 3) % 2 !== 0) throw new Error("Unsupported or malformed session path")
        const width = numeric(path[2]) / scale
        if (width <= 0) throw new Error("Nonpositive session wire width")
        const route: SimplifiedPcbTrace["route"] = []
        for (let i = 3; i < path.length; i += 2) route.push({ route_type: "wire", x: numeric(path[i]) / scale, y: numeric(path[i + 1]) / scale, width, layer: sessionLayers[path[1]] })
        traces.push({ type: "pcb_trace", pcb_trace_id: `freerouting_${traces.length}`, connection_name: name, route })
      } else if (item[0] === "via") {
        if (item[1] !== viaName || item.length < 4 || item.slice(4).some((node) => !Array.isArray(node) || node[0] !== "type")) throw new Error("Unknown or malformed session via")
        traces.push({ type: "pcb_trace", pcb_trace_id: `freerouting_${traces.length}`, connection_name: name, route: [{ route_type: "via", x: numeric(item[2]) / scale, y: numeric(item[3]) / scale, from_layer: "top", to_layer: "bottom", via_diameter: srj.minViaPadDiameter, via_hole_diameter: srj.minViaHoleDiameter }] })
      } else throw new Error(`Unsupported session copper item ${item[0]}`)
    }
  }
  return traces
}
