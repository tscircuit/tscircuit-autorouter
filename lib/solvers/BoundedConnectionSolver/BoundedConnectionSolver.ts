import { distance } from "@tscircuit/math-utils"
import { findClearancePath, type ClearancePathInput } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { EscapeViaMetadata } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import { type SimpleRouteConnection, type SimpleRouteJson, type SimplifiedPcbTrace, isSingleLayerConnectionPoint } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getBoundedTerminalGroups, type BoundedTerminalGroup } from "./getBoundedTerminalGroups"

type XY = { x: number; y: number }
type Point = XY & { z: number }
type Trunk = { group: BoundedTerminalGroup; indices: number[]; path: Point[]; trace: SimplifiedPcbTrace }
type Tree = { traces: SimplifiedPcbTrace[]; length: number; longestPathRatio: number }

function lengthOf(path: Point[]): number {
  let length = 0
  for (let i = 1; i < path.length; i++) length += distance(path[i - 1]!, path[i]!)
  return length
}

/** Route length-limited, via-free connections before ordinary point-pair routing consumes their escape channels. */
export class BoundedConnectionSolver extends BaseSolver {
  readonly traces: SimplifiedPcbTrace[] = []
  private readonly groups: BoundedTerminalGroup[]
  private readonly context: SimpleRouteJson
  private readonly via: ReturnType<typeof getViaDimensions>
  private readonly occupiedIds: Set<string>
  private readonly clearance: number

  constructor(readonly input: SimpleRouteJson, escapes: EscapeViaMetadata[]) {
    super()
    this.groups = getBoundedTerminalGroups(input)
    this.via = getViaDimensions(input)
    this.clearance = input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.15
    this.occupiedIds = new Set(input.traces?.map((t) => t.pcb_trace_id))
    this.context = { ...input, traces: [...(input.traces ?? [])] }
    if (!this.groups.length) return
    const connections = new Map(input.connections.map((c) => [c.name, c]))
    for (const escape of escapes) {
      const connection = connections.get(escape.connectionName)!
      const pin = connection.pointsToConnect[escape.sourcePointIndex]!
      this.context.traces!.push({
        type: "pcb_trace", pcb_trace_id: escape.pointId, connection_name: connection.name,
        route: [pin, escape].map(({ x, y }) => ({ x, y, route_type: "wire", layer: escape.sourceLayer, width: connection.nominalTraceWidth ?? input.minTraceWidth })),
      })
    }
  }

  private search(connection: SimpleRouteConnection, a: XY, b: XY, layer: string, extra: SimplifiedPcbTrace[], margin: number, neighbor = false): Point[] | null {
    const z = mapLayerNameToZ(layer, this.input.layerCount)
    const start = { ...a, z }, end = { ...b, z }
    const width = connection.nominalTraceWidth ?? connection.width ?? this.input.minTraceWidth
    const board = this.input.bounds
    return findClearancePath({
      srj: { ...this.context, traces: [...this.context.traces!, ...this.traces, ...extra] } as ClearancePathInput["srj"],
      routes: [{ connectionName: connection.name, route: [start, end], vias: [], viaDiameter: this.via.padDiameter, traceThickness: width }],
      start, end, routeIndex: 0, traceThickness: width,
      traceClearance: this.clearance, viaClearance: getViaToPadClearance(this.input) ?? this.clearance,
      viaHoleDiameter: this.via.holeDiameter, allowLayerChanges: neighbor,
      gridSize: neighbor ? this.via.padDiameter / 6 : width / 2, maxNodes: 150000,
      bounds: {
        minX: Math.max(board.minX, Math.min(a.x, b.x) - margin), minY: Math.max(board.minY, Math.min(a.y, b.y) - margin),
        maxX: Math.min(board.maxX, Math.max(a.x, b.x) + margin), maxY: Math.min(board.maxY, Math.max(a.y, b.y) + margin),
      },
      getAdditionalEdgeCost: neighbor ? (p, q) => p.z === z && q.z === z ? 8 * distance(p, q) : 0 : undefined,
    })
  }

  private makeTrace(c: SimpleRouteConnection, path: Point[], suffix: string, pins: (string | undefined)[]): SimplifiedPcbTrace {
    const base = `${c.name}_${suffix}`
    let id = base
    for (let i = 1; this.occupiedIds.has(id); i++) id = `${base}_${i}`
    return { type: "pcb_trace", pcb_trace_id: id, connection_name: c.name, isFixed: true,
      connectsTo: pins.filter((id): id is string => id !== undefined),
      route: convertHdRouteToSimplifiedRoute({ connectionName: c.name, route: path, vias: path.filter((p, i) => i > 0 && p.z !== path[i - 1]!.z), traceThickness: c.nominalTraceWidth ?? c.width ?? this.input.minTraceWidth, viaDiameter: this.via.padDiameter }, this.input.layerCount, { defaultViaHoleDiameter: this.via.holeDiameter }),
    }
  }

  private attachBranch(trunk: Trunk, other: SimplifiedPcbTrace[]): Tree | undefined {
    const { group, indices, path, trace } = trunk
    if (indices.length === 2) return { traces: [trace], length: lengthOf(path), longestPathRatio: lengthOf(path) / Math.min(...group.limits) }
    const [a, b, c] = indices as [number, number, number]
    const pin = group.points[c]!
    const spacing = (group.connection.nominalTraceWidth ?? this.input.minTraceWidth) + this.clearance
    const samples: Array<{ point: Point; segment: number; lowerBound: number }> = []
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1]!, q = path[i]!
      const divisions = Math.ceil(distance(p, q) / spacing)
      for (let j = 0; j <= divisions && divisions > 0; j++) {
        if ((i === 1 && j === 0) || (i === path.length - 1 && j === divisions)) continue
        const t = j / divisions
        const point = { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z }
        samples.push({ point, segment: i, lowerBound: distance(pin, point) })
      }
    }
    samples.sort((x, y) => x.lowerBound - y.lowerBound)
    let best: Tree | undefined
    let bestTap = group.limits[c]!
    for (const { point, segment, lowerBound } of samples) {
      if (lowerBound > bestTap) break
      const arms = [[...path.slice(0, segment), point], [...path.slice(segment).reverse(), point]]
      if (lengthOf(arms[0]!) > group.limits[a]! || lengthOf(arms[1]!) > group.limits[b]!) continue
      const tap = this.search(group.connection, pin, point, pin.layer, other, group.limits[c]!)
      if (!tap || lengthOf(tap) > bestTap || (best && lengthOf(tap) === bestTap)) continue
      bestTap = lengthOf(tap)
      arms.push(tap)
      best = { traces: arms.map((arm, i) => this.makeTrace(group.connection, arm, `branch_${i}`, [group.points[indices[i]!]!.pointId])), length: lengthOf(path) + bestTap, longestPathRatio: Math.max(...arms.flatMap((arm, i) => arms.slice(i + 1).map((other, j) => (lengthOf(arm) + lengthOf(other)) / Math.max(group.limits[indices[i]!]!, group.limits[indices[i+j+1]!]!)))) }
    }
    return best
  }

  private plan(groups: BoundedTerminalGroup[]): Tree | undefined {
    let best: Tree | undefined
    const attach = (pending: Trunk[], trees: Tree[]): void => {
      const [trunk, ...rest] = pending
      if (!trunk) {
        const length = trees.reduce((sum, tree) => sum + tree.length, 0)
        const longestPathRatio = Math.max(...trees.map((tree) => tree.longestPathRatio))
        if (!best || longestPathRatio < best.longestPathRatio || (longestPathRatio === best.longestPathRatio && length < best.length)) best = { length, longestPathRatio, traces: trees.flatMap((tree) => tree.traces) }
        return
      }
      const tree = this.attachBranch(trunk, [...trees.flatMap((t) => t.traces), ...rest.map((t) => t.trace)])
      if (tree) attach(rest, [...trees, tree])
    }
    const chooseTrunks = (pending: BoundedTerminalGroup[], trunks: Trunk[]): void => {
      const [group, ...rest] = pending
      if (!group) {
        attach(trunks, [])
        if (trunks.length > 1) attach([...trunks].reverse(), [])
        return
      }
      const orders = group.points.length === 2 ? [[0, 1]] : [[0, 1, 2], [0, 2, 1], [1, 2, 0]]
      for (const indices of orders) {
        const a = group.points[indices[0]!]!, b = group.points[indices[1]!]!
        const budget = group.points.length === 2
          ? Math.min(group.limits[indices[0]!]!, group.limits[indices[1]!]!)
          : group.limits[indices[0]!]! + group.limits[indices[1]!]!
        const path = this.search(group.connection, a, b, a.layer, trunks.map((t) => t.trace), Math.max(...group.limits))
        if (!path || lengthOf(path) > budget) continue
        const trace = this.makeTrace(group.connection, path, "trunk", [a.pointId, b.pointId])
        chooseTrunks(rest, [...trunks, { group, indices, path, trace }])
      }
    }
    chooseTrunks(groups, [])
    if (groups.length > 1) chooseTrunks([...groups].reverse(), [])
    return best
  }

  override _step(): void {
    const first = this.groups.shift()
    if (!first) { this.solved = true; return }
    const groups = [first]
    // Jointly plan at most two neighboring stars, bounding the trunk permutations.
    const neighboring = this.groups.findIndex((g) => first.points.some((a) => g.points.some((b) => a.layer === b.layer && distance(a, b) < this.via.padDiameter)))
    if (neighboring >= 0) groups.push(this.groups.splice(neighboring, 1)[0]!)
    const pins = groups.flatMap((g) => g.points)
    const excluded = new Set([...this.groups, ...groups].map((g) => g.connection.name))
    for (const c of this.input.connections) {
      if (excluded.has(c.name) || c.netConnectionName || c.path || c.isOffBoard || c.externallyConnectedPointIds?.length || c.maxLength !== undefined || c.maxViaCount !== undefined || c.pointsToConnect.length !== 2) continue
      if (this.input.buses?.some((bus) => bus.connectionNames.includes(c.name)) || this.input.differentialPairs?.some((pair) => pair.connectionNames.includes(c.name))) continue
      if (this.input.connections.some((branch) => branch.netConnectionName === c.name && (branch.maxLength !== undefined || branch.maxViaCount !== undefined))) continue
      if (this.context.traces!.some((t) => t.connection_name === c.name) || this.traces.some((t) => t.connection_name === c.name)) continue
      const [a, b] = c.pointsToConnect
      if (!a || !b || !isSingleLayerConnectionPoint(a) || !isSingleLayerConnectionPoint(b) || a.layer !== b.layer || a.terminalVia || b.terminalVia) continue
      if (distance(a, b) > Math.max(...groups.flatMap((group) => group.limits))) continue
      if (!pins.some((p) => p.layer === a.layer && Math.min(distance(a, p), distance(b, p)) < this.via.padDiameter)) continue
      const path = this.search(c, a, b, a.layer, [], 5 * this.via.padDiameter, true)
      if (path) this.traces.push(this.makeTrace(c, path, "escape", [a.pointId, b.pointId]))
    }
    const plan = this.plan(groups)
    if (!plan) throw new Error(`No via-free routing within the length budgets for ${groups.map((g) => g.connection.name).join(", ")}`)
    this.traces.push(...plan.traces)
    for (const t of this.traces) this.occupiedIds.add(t.pcb_trace_id)
  }

  getRoutingInput(input: SimpleRouteJson): SimpleRouteJson {
    if (!this.traces.length) return input
    const routed = new Set(this.traces.map((t) => t.connection_name))
    return { ...input, traces: [...(input.traces ?? []), ...this.traces], connections: input.connections.filter((c) => !routed.has(c.name)) }
  }
}
