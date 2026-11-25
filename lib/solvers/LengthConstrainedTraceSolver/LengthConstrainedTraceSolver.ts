import { assignUniquePcbTraceIdsToNewTraces } from "lib/utils/assignUniquePcbTraceIdsToNewTraces"
import { distance } from "@tscircuit/math-utils"
import { findClearancePath, type ClearancePathInput } from "@tscircuit/repair04"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { EscapeViaMetadata } from "lib/solvers/EscapeViaLocationSolver/EscapeViaLocationSolver"
import {
  type SimpleRouteConnection,
  type SimpleRouteJson,
  type SimplifiedPcbTrace,
  isSingleLayerConnectionPoint,
} from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  getLengthConstrainedConnections,
  type LengthConstrainedConnection,
} from "./getLengthConstrainedConnections"

type XY = { x: number; y: number }
type Point = XY & { z: number }
type Trunk = {
  group: LengthConstrainedConnection
  indices: number[]
  path: Point[]
  trace: SimplifiedPcbTrace
}
type Tree = {
  traces: SimplifiedPcbTrace[]
  length: number
  longestPathRatio: number
}

function lengthOf(path: Point[]): number {
  let length = 0
  for (let i = 1; i < path.length; i++)
    length += distance(path[i - 1]!, path[i]!)
  return length
}

/** Route length-limited, via-free connections before ordinary point-pair routing consumes their escape channels. */
export class LengthConstrainedTraceSolver extends BaseSolver {
  traces: SimplifiedPcbTrace[] = []
  private readonly groups: LengthConstrainedConnection[]
  private readonly existingTraces: SimplifiedPcbTrace[]
  private readonly via: ReturnType<typeof getViaDimensions>
  private readonly clearance: number

  constructor(
    readonly input: SimpleRouteJson,
    escapes: EscapeViaMetadata[],
  ) {
    super()
    this.groups = getLengthConstrainedConnections(input)
    this.via = getViaDimensions(input)
    this.clearance =
      input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin ?? 0.15
    this.existingTraces = this.groups.length ? [...(input.traces ?? [])] : []
    if (!this.groups.length) return
    const connections = new Map(input.connections.map((c) => [c.name, c]))
    for (const escape of escapes) {
      const connection = connections.get(escape.connectionName)!
      const pin = connection.pointsToConnect[escape.sourcePointIndex]!
      this.existingTraces.push({
        type: "pcb_trace",
        pcb_trace_id: escape.pointId,
        connection_name: connection.name,
        route: [pin, escape].map(({ x, y }) => ({
          x,
          y,
          route_type: "wire",
          layer: escape.sourceLayer,
          width: connection.nominalTraceWidth ?? input.minTraceWidth,
        })),
      })
    }
  }

  private search(
    connection: SimpleRouteConnection,
    a: XY,
    b: XY,
    layer: string,
    extra: SimplifiedPcbTrace[],
    margin: number,
    neighbor = false,
  ): Point[] | null {
    const z = mapLayerNameToZ(layer, this.input.layerCount)
    const start = { ...a, z },
      end = { ...b, z }
    const width =
      connection.nominalTraceWidth ??
      connection.width ??
      this.input.minTraceWidth
    const board = this.input.bounds
    return findClearancePath({
      srj: {
        ...this.input,
        traces: [...this.existingTraces, ...this.traces, ...extra],
      } as ClearancePathInput["srj"],
      routes: [
        {
          connectionName: connection.name,
          route: [start, end],
          vias: [],
          viaDiameter: this.via.padDiameter,
          traceThickness: width,
        },
      ],
      start,
      end,
      routeIndex: 0,
      traceThickness: width,
      traceClearance: this.clearance,
      viaClearance: getViaToPadClearance(this.input) ?? this.clearance,
      viaHoleDiameter: this.via.holeDiameter,
      allowLayerChanges: neighbor,
      gridSize: neighbor ? this.via.padDiameter / 6 : width / 2,
      maxNodes: 150000,
      bounds: {
        minX: Math.max(board.minX, Math.min(a.x, b.x) - margin),
        minY: Math.max(board.minY, Math.min(a.y, b.y) - margin),
        maxX: Math.min(board.maxX, Math.max(a.x, b.x) + margin),
        maxY: Math.min(board.maxY, Math.max(a.y, b.y) + margin),
      },
      getAdditionalEdgeCost: neighbor
        ? (p, q) => (p.z === z && q.z === z ? 8 * distance(p, q) : 0)
        : undefined,
    })
  }

  private makeTrace(
    c: SimpleRouteConnection,
    path: Point[],
    suffix: string,
    pins: (string | undefined)[],
  ): SimplifiedPcbTrace {
    return {
      type: "pcb_trace",
      pcb_trace_id: `${c.name}_${suffix}`,
      connection_name: c.name,
      isFixed: true,
      connectsTo: pins.filter((id): id is string => id !== undefined),
      route: convertHdRouteToSimplifiedRoute(
        {
          connectionName: c.name,
          route: path,
          vias: path.filter((p, i) => i > 0 && p.z !== path[i - 1]!.z),
          traceThickness:
            c.nominalTraceWidth ?? c.width ?? this.input.minTraceWidth,
          viaDiameter: this.via.padDiameter,
        },
        this.input.layerCount,
        { defaultViaHoleDiameter: this.via.holeDiameter },
      ),
    }
  }

  private attachBranch(
    trunk: Trunk,
    other: SimplifiedPcbTrace[],
  ): Tree | undefined {
    const { group, indices, path, trace } = trunk
    if (indices.length === 2)
      return {
        traces: [trace],
        length: lengthOf(path),
        longestPathRatio: lengthOf(path) / Math.min(...group.limits),
      }
    const [a, b, c] = indices as [number, number, number]
    const pin = group.points[c]!
    const spacing =
      (group.connection.nominalTraceWidth ?? this.input.minTraceWidth) +
      this.clearance
    const samples: Array<{
      point: Point
      segment: number
      lowerBound: number
    }> = []
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1]!,
        q = path[i]!
      const divisions = Math.ceil(distance(p, q) / spacing)
      for (let j = 0; j <= divisions && divisions > 0; j++) {
        if ((i === 1 && j === 0) || (i === path.length - 1 && j === divisions))
          continue
        const t = j / divisions
        const point = {
          x: p.x + (q.x - p.x) * t,
          y: p.y + (q.y - p.y) * t,
          z: p.z,
        }
        samples.push({ point, segment: i, lowerBound: distance(pin, point) })
      }
    }
    samples.sort((x, y) => x.lowerBound - y.lowerBound)
    let best: Tree | undefined
    let bestTap = group.limits[c]!
    for (const { point, segment, lowerBound } of samples) {
      if (lowerBound > bestTap) break
      const arms = [
        [...path.slice(0, segment), point],
        [...path.slice(segment).reverse(), point],
      ]
      if (
        lengthOf(arms[0]!) > group.limits[a]! ||
        lengthOf(arms[1]!) > group.limits[b]!
      )
        continue
      const tap = this.search(
        group.connection,
        pin,
        point,
        pin.layer,
        other,
        group.limits[c]!,
      )
      if (!tap) continue
      const tapLength = lengthOf(tap)
      if (tapLength > bestTap || (best && tapLength === bestTap)) continue
      bestTap = tapLength
      arms.push(tap)
      const lengths = arms.map(lengthOf)
      const pairRatio = (i: number, j: number): number =>
        (lengths[i]! + lengths[j]!) /
        Math.max(group.limits[indices[i]!]!, group.limits[indices[j]!]!)
      best = {
        traces: arms.map((arm, i) =>
          this.makeTrace(group.connection, arm, `branch_${i}`, [
            group.points[indices[i]!]!.pointId,
          ]),
        ),
        length: lengthOf(path) + tapLength,
        longestPathRatio: Math.max(
          pairRatio(0, 1),
          pairRatio(0, 2),
          pairRatio(1, 2),
        ),
      }
    }
    return best
  }

  private getTrunks(
    group: LengthConstrainedConnection,
    otherTrunks: Trunk[],
  ): Trunk[] {
    const trunks: Trunk[] = []
    const pairs =
      group.points.length === 2
        ? [[0, 1]]
        : [
            [0, 1, 2],
            [0, 2, 1],
            [1, 2, 0],
          ]
    for (const indices of pairs) {
      const a = group.points[indices[0]!]!
      const b = group.points[indices[1]!]!
      // A three-pin connection splits the trunk at the branch junction.
      const limit =
        indices.length === 2
          ? Math.min(...group.limits)
          : group.limits[indices[0]!]! + group.limits[indices[1]!]!
      const path = this.search(
        group.connection,
        a,
        b,
        a.layer,
        otherTrunks.map((t) => t.trace),
        Math.max(...group.limits),
      )
      if (!path || lengthOf(path) > limit) continue
      const trace = this.makeTrace(group.connection, path, "trunk", [
        a.pointId,
        b.pointId,
      ])
      trunks.push({ group, indices, path, trace })
    }
    return trunks
  }

  private routeBranches(trunks: Trunk[]): Tree | undefined {
    const traces: SimplifiedPcbTrace[] = []
    let length = 0
    let longestPathRatio = 0
    for (const [i, trunk] of trunks.entries()) {
      const remainingTrunks = trunks.slice(i + 1).map((t) => t.trace)
      const tree = this.attachBranch(trunk, [...traces, ...remainingTrunks])
      if (!tree) return
      traces.push(...tree.traces)
      length += tree.length
      longestPathRatio = Math.max(longestPathRatio, tree.longestPathRatio)
    }
    return { traces, length, longestPathRatio }
  }

  private plan(
    groups: LengthConstrainedConnection[],
  ): SimplifiedPcbTrace[] | undefined {
    let best: Tree | undefined
    // Place the trunks before branching. The first branch can otherwise
    // occupy the only single-layer path available to the neighboring net.
    const orders =
      groups.length === 1 ? [groups] : [groups, [...groups].reverse()]
    for (const order of orders) {
      let candidates: Trunk[][] = [[]]
      for (const group of order) {
        candidates = candidates.flatMap((trunks) =>
          this.getTrunks(group, trunks).map((next) => [...trunks, next]),
        )
      }
      for (const trunks of candidates) {
        const branchOrders =
          trunks.length === 1 ? [trunks] : [trunks, [...trunks].reverse()]
        for (const branches of branchOrders) {
          const tree = this.routeBranches(branches)
          if (
            tree &&
            (!best ||
              tree.longestPathRatio < best.longestPathRatio ||
              (tree.longestPathRatio === best.longestPathRatio &&
                tree.length < best.length))
          )
            best = tree
        }
      }
    }
    return best?.traces
  }

  override _step(): void {
    const first = this.groups.shift()
    if (!first) {
      if (this.traces.length) {
        this.traces = assignUniquePcbTraceIdsToNewTraces(
          this.traces,
          this.input.traces ?? [],
        )
      }
      this.solved = true
      return
    }
    const groups = [first]
    // Adjacent pins can share an escape channel. Plan one competing net at a time.
    const neighboring = this.groups.findIndex((g) =>
      first.points.some((a) =>
        g.points.some(
          (b) => a.layer === b.layer && distance(a, b) < this.via.padDiameter,
        ),
      ),
    )
    if (neighboring >= 0) groups.push(this.groups.splice(neighboring, 1)[0]!)
    const pins = groups.flatMap((g) => g.points)
    const maxLength = Math.max(...groups.flatMap((g) => g.limits))
    const excluded = new Set([
      ...this.input.connections
        .filter((c) => c.maxLength !== undefined || c.maxViaCount !== undefined)
        .map((c) => c.netConnectionName ?? c.name),
      ...(this.input.buses ?? []).flatMap((bus) => bus.connectionNames),
      ...(this.input.differentialPairs ?? []).flatMap(
        (pair) => pair.connectionNames,
      ),
      ...this.existingTraces.map((t) => t.connection_name),
      ...this.traces.map((t) => t.connection_name),
    ])
    for (const c of this.input.connections) {
      if (
        excluded.has(c.name) ||
        c.netConnectionName ||
        c.path ||
        c.isOffBoard ||
        c.externallyConnectedPointIds?.length ||
        c.pointsToConnect.length !== 2
      )
        continue
      const [a, b] = c.pointsToConnect
      if (
        !a ||
        !b ||
        !isSingleLayerConnectionPoint(a) ||
        !isSingleLayerConnectionPoint(b) ||
        a.layer !== b.layer ||
        a.terminalVia ||
        b.terminalVia
      )
        continue
      if (distance(a, b) > maxLength) continue
      if (
        !pins.some(
          (p) =>
            p.layer === a.layer &&
            Math.min(distance(a, p), distance(b, p)) < this.via.padDiameter,
        )
      )
        continue
      const path = this.search(
        c,
        a,
        b,
        a.layer,
        [],
        5 * this.via.padDiameter,
        true,
      )
      if (path)
        this.traces.push(
          this.makeTrace(c, path, "escape", [a.pointId, b.pointId]),
        )
    }
    const plan = this.plan(groups)
    if (!plan)
      throw new Error(
        `No via-free routing within the length budgets for ${groups.map((g) => g.connection.name).join(", ")}`,
      )
    this.traces.push(...plan)
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    if (!this.traces.length) return this.input
    const routed = new Set(this.traces.map((t) => t.connection_name))
    return {
      ...this.input,
      traces: [...(this.input.traces ?? []), ...this.traces],
      connections: this.input.connections.filter((c) => !routed.has(c.name)),
    }
  }
}
