/**
 * Topological Autorouter Pipeline (WASM)
 *
 * This pipeline wraps the gEDA toporouter (Anthony Blake, SURF system)
 * compiled to WebAssembly via Emscripten. It provides topological routing
 * with rubberband arc optimization through a Constrained Delaunay
 * Triangulation (CDT).
 *
 * LICENSE: The underlying toporouter C code is GPLv2+. This pipeline
 * is provided for comparison/evaluation purposes only and should NOT
 * be merged into production due to its GPL license.
 */

import type { GraphicsObject, Line } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTraces,
  SimplifiedPcbTrace,
  ConnectionPoint,
} from "../../types"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getColorMap } from "../../solvers/colors"
import { combineVisualizations } from "../../utils/combineVisualizations"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

let wasmModulePromise: Promise<any> | null = null
let wasmModule: any = null

async function loadWasmModule(): Promise<any> {
  if (wasmModule) return wasmModule

  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const wasmJsUrl = new URL("./wasm/toporouter.js", import.meta.url)
      const wasmUrl = new URL("./wasm/toporouter.wasm", import.meta.url)

      let jsCode: string
      let wasmBinary: ArrayBuffer | undefined

      if (wasmJsUrl.protocol === "file:") {
        const fs = await import("fs")
        jsCode = fs.readFileSync(wasmJsUrl, "utf-8")
        // Use slice to avoid Buffer pooling issues where .buffer is larger than the data
        const buf = fs.readFileSync(wasmUrl)
        wasmBinary = buf.buffer.slice(
          buf.byteOffset,
          buf.byteOffset + buf.byteLength,
        )
      } else {
        const [jsResp, wasmResp] = await Promise.all([
          fetch(wasmJsUrl.href),
          fetch(wasmUrl.href),
        ])
        jsCode = await jsResp.text()
        wasmBinary = await wasmResp.arrayBuffer()
      }

      // Use blob URL import to avoid CSP unsafe-eval issues with new Function()
      const wrappedCode = `${jsCode}\nexport default ToporouterModule;`
      const blob = new Blob([wrappedCode], { type: "text/javascript" })
      const blobUrl = URL.createObjectURL(blob)
      try {
        const mod: any = await import(/* webpackIgnore: true */ blobUrl)
        const factory = mod.default
        wasmModule = await factory({ wasmBinary })
      } catch {
        // Fallback for environments where blob import fails (e.g. bun)
        const factory = new Function(`${jsCode}; return ToporouterModule;`)()
        wasmModule = await factory({ wasmBinary })
      } finally {
        URL.revokeObjectURL(blobUrl)
      }
      return wasmModule
    })().catch((e) => {
      // Reset so future calls can retry
      wasmModulePromise = null
      throw e
    })
  }

  return wasmModulePromise
}

function getConnectionPointLayers(pt: ConnectionPoint): string[] {
  if ("layers" in pt) return pt.layers
  if ("layer" in pt) return [pt.layer]
  return ["top"]
}

function getLayerIndex(layerName: string): number {
  if (layerName === "top" || layerName === "front") return 0
  if (layerName === "bottom" || layerName === "back") return 1
  const m = layerName.match(/inner(\d+)/)
  if (m) return Number.parseInt(m[1]) + 2
  return 0
}

interface TopoRouteResult {
  netName: string
  path: Array<{ x: number; y: number }>
  arcs: Array<{
    cx: number
    cy: number
    r: number
    dir: number
    x0: number
    y0: number
    x1: number
    y1: number
  }>
}

interface TopoSolveResult {
  routes: TopoRouteResult[]
  stats: { routed: number; failed: number; wiringScore: number }
  cdtEdges: Array<{
    v1: { x: number; y: number }
    v2: { x: number; y: number }
    isConstraint: boolean
  }>
}

export class ToporouterWasmPipelineSolver extends BaseSolver {
  override getSolverName(): string {
    return "ToporouterWasmPipelineSolver"
  }

  private result: TopoSolveResult | null = null
  private traces: SimplifiedPcbTraces = []
  private phase: "loading" | "solving" | "done" = "loading"
  private loadingStarted = false
  private colorMap: Record<string, string>
  private connMap: ConnectivityMap

  constructor(
    public readonly srj: SimpleRouteJson,
    public readonly opts: { effort?: number } = {},
  ) {
    super()
    this.MAX_ITERATIONS = 100_000
    this.connMap = getConnectivityMapFromSimpleRouteJson(srj)
    this.colorMap = getColorMap(srj, this.connMap)
  }

  getConstructorParams() {
    return [this.srj, this.opts] as const
  }

  /** Override solve() to handle async WASM loading */
  override async solve() {
    const startTime = Date.now()
    const mod = await loadWasmModule()
    try {
      this.solveWithWasm(mod)
      this.solved = true
      this.progress = 1
    } catch (e) {
      this.error = `ToporouterWasm error: ${e}`
      this.failed = true
    }
    this.timeToSolve = Date.now() - startTime
  }

  _step() {
    if (this.phase === "loading") {
      if (!this.loadingStarted) {
        this.loadingStarted = true
        this.progress = 0.05
        loadWasmModule()
          .then((mod) => {
            this.phase = "solving"
            this.progress = 0.2
            try {
              this.solveWithWasm(mod)
              this.phase = "done"
              this.solved = true
              this.progress = 1
            } catch (e) {
              this.error = `ToporouterWasm error: ${e}`
              this.failed = true
            }
          })
          .catch((e) => {
            this.error = `WASM load error: ${e}`
            this.failed = true
          })
      }
      return
    }
  }

  private solveWithWasm(Module: any) {
    const { srj } = this
    const bounds = srj.bounds
    const bw = bounds.maxX - bounds.minX
    const bh = bounds.maxY - bounds.minY
    // Scale to toporouter internal units. Must be large enough that
    // pin constraint polygons and board edges create well-formed CDT
    // triangulations with plenty of interior triangles for A* expansion.
    const scale = 10000

    const wrap = (name: string, ret: any, args: any[]) =>
      Module.cwrap(name, ret, args)
    const _topo_create = wrap("topo_create", "number", ["number", "number"])
    const _topo_destroy = wrap("topo_destroy", null, ["number"])
    const _topo_set_trace_width = wrap("topo_set_trace_width", null, [
      "number",
      "number",
    ])
    const _topo_set_keepaway = wrap("topo_set_keepaway", null, [
      "number",
      "number",
    ])
    const _topo_set_via_cost = wrap("topo_set_via_cost", null, [
      "number",
      "number",
    ])
    const _topo_add_obstacle = wrap("topo_add_obstacle", "number", [
      "number",
      "number",
      "number",
      "number",
      "number",
      "string",
      "number",
    ])
    const _topo_add_connection = wrap("topo_add_connection", "number", [
      "number",
      "number",
      "number",
      "string",
    ])
    const _topo_solve = wrap("topo_solve", "number", ["number"])
    const _topo_get_num_routed = wrap("topo_get_num_routed", "number", [
      "number",
    ])
    const _topo_get_num_failed = wrap("topo_get_num_failed", "number", [
      "number",
    ])
    const _topo_get_wiring_score = wrap("topo_get_wiring_score", "number", [
      "number",
    ])
    const _topo_get_num_routes = wrap("topo_get_num_routes", "number", [
      "number",
    ])
    const _topo_get_route_path_len = wrap("topo_get_route_path_len", "number", [
      "number",
      "number",
    ])
    const _topo_get_route_point = wrap("topo_get_route_point", null, [
      "number",
      "number",
      "number",
      "number",
      "number",
    ])
    const _topo_get_route_net_name = wrap("topo_get_route_net_name", "string", [
      "number",
      "number",
    ])
    const _topo_get_route_num_arcs = wrap("topo_get_route_num_arcs", "number", [
      "number",
      "number",
    ])
    const _topo_get_route_arc = wrap("topo_get_route_arc", null, [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ])
    const _topo_get_num_cdt_edges = wrap("topo_get_num_cdt_edges", "number", [
      "number",
    ])
    const _topo_get_cdt_edge = wrap("topo_get_cdt_edge", null, [
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
      "number",
    ])

    const ptr = _topo_create(bw * scale, bh * scale)
    const xBuf = Module._malloc(8)
    const yBuf = Module._malloc(8)

    try {
      const tw = (srj.nominalTraceWidth ?? srj.minTraceWidth) * scale
      const ka = (srj.defaultObstacleMargin ?? srj.minTraceWidth / 2) * scale
      _topo_set_trace_width(ptr, tw)
      _topo_set_keepaway(ptr, ka)
      _topo_set_via_cost(ptr, 10000)

      // Scaled obstacle rects for nudging
      const obsRects: Array<{
        ox: number
        oy: number
        hw: number
        hh: number
      }> = []
      for (const obs of srj.obstacles) {
        obsRects.push({
          ox: (obs.center.x - bounds.minX) * scale,
          oy: (obs.center.y - bounds.minY) * scale,
          hw: (obs.width / 2) * scale,
          hh: (obs.height / 2) * scale,
        })
      }

      // Add ALL SRJ obstacles as blockers.
      for (let oi = 0; oi < srj.obstacles.length; oi++) {
        const obs = srj.obstacles[oi]
        const { ox, oy, hw, hh } = obsRects[oi]
        const r = Math.max(hw, hh)
        const layer = getLayerIndex(obs.layers?.[0] ?? "top")
        _topo_add_obstacle(ptr, ox, oy, r, 3, null, layer)
      }

      // Nudge a point outside ALL obstacle+keepaway zones.
      // Margin includes keepaway, trace width, and the pin's own radius
      // so the nudged pin's constraint polygon doesn't overlap obstacles.
      const pinRadius = Math.max(tw, ka) * 1.5
      const nudgeMargin = ka + tw + pinRadius * 2
      const boardW = bw * scale
      const boardH = bh * scale

      function isInsideAnyObstacle(px: number, py: number): boolean {
        for (const { ox, oy, hw, hh } of obsRects) {
          if (
            px > ox - hw - nudgeMargin &&
            px < ox + hw + nudgeMargin &&
            py > oy - hh - nudgeMargin &&
            py < oy + hh + nudgeMargin
          )
            return true
        }
        return false
      }

      function nudgePoint(px: number, py: number): { x: number; y: number } {
        if (!isInsideAnyObstacle(px, py)) return { x: px, y: py }

        // Try nudging in each cardinal direction with increasing distance
        const directions = [
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
          { dx: 1, dy: 1 },
          { dx: -1, dy: -1 },
          { dx: 1, dy: -1 },
          { dx: -1, dy: 1 },
        ]
        for (let dist = nudgeMargin; dist < boardW; dist += nudgeMargin * 0.5) {
          for (const { dx, dy } of directions) {
            const norm = Math.sqrt(dx * dx + dy * dy)
            const nx = px + (dx / norm) * dist
            const ny = py + (dy / norm) * dist
            if (
              nx > nudgeMargin &&
              nx < boardW - nudgeMargin &&
              ny > nudgeMargin &&
              ny < boardH - nudgeMargin &&
              !isInsideAnyObstacle(nx, ny)
            ) {
              return { x: nx, y: ny }
            }
          }
        }
        // Couldn't find a clear spot — return clamped position
        return {
          x: Math.max(nudgeMargin, Math.min(boardW - nudgeMargin, px)),
          y: Math.max(nudgeMargin, Math.min(boardH - nudgeMargin, py)),
        }
      }

      // Build connection points with nudged positions.
      // Key includes connection name to avoid cross-net deduplication.
      const originalPositions = new Map<string, { x: number; y: number }>()
      const pointObsIds = new Map<string, number>()

      for (const conn of srj.connections) {
        const ptIds: number[] = []

        for (const pt of conn.pointsToConnect) {
          const ptKey = `${conn.name}:${pt.x.toFixed(6)},${pt.y.toFixed(6)}`
          let obsId: number = pointObsIds.get(ptKey) ?? -1

          if (obsId === -1) {
            const rawX = (pt.x - bounds.minX) * scale
            const rawY = (pt.y - bounds.minY) * scale
            const nudged = nudgePoint(rawX, rawY)
            const layers = getConnectionPointLayers(pt)
            const layer = getLayerIndex(layers[0])

            originalPositions.set(ptKey, { x: pt.x, y: pt.y })

            // Pin radius must be large enough for the CDT constraint
            // polygon to function properly (A* expands from inside it).
            const pinRadius = Math.max(tw, ka) * 1.5
            obsId = _topo_add_obstacle(
              ptr,
              nudged.x,
              nudged.y,
              pinRadius,
              0,
              conn.name,
              layer,
            ) as number
            pointObsIds.set(ptKey, obsId)
          }
          ptIds.push(obsId)
        }

        for (let i = 0; i < ptIds.length - 1; i++) {
          _topo_add_connection(ptr, ptIds[i], ptIds[i + 1], conn.name)
        }
      }

      _topo_solve(ptr)

      const stats = {
        routed: _topo_get_num_routed(ptr) as number,
        failed: _topo_get_num_failed(ptr) as number,
        wiringScore: _topo_get_wiring_score(ptr) as number,
      }

      // Extract routes
      const numRoutes = _topo_get_num_routes(ptr) as number
      const routes: TopoRouteResult[] = []

      for (let i = 0; i < numRoutes; i++) {
        const netName = _topo_get_route_net_name(ptr, i) as string
        const pathLen = _topo_get_route_path_len(ptr, i) as number
        const path: Array<{ x: number; y: number }> = []

        for (let j = 0; j < pathLen; j++) {
          _topo_get_route_point(ptr, i, j, xBuf, yBuf)
          path.push({
            x: Module.getValue(xBuf, "double") / scale + bounds.minX,
            y: Module.getValue(yBuf, "double") / scale + bounds.minY,
          })
        }

        const numArcs = _topo_get_route_num_arcs(ptr, i) as number
        const arcs: TopoRouteResult["arcs"] = []

        if (numArcs > 0) {
          const cxB = Module._malloc(8)
          const cyB = Module._malloc(8)
          const rB = Module._malloc(8)
          const dirB = Module._malloc(4)
          const x0B = Module._malloc(8)
          const y0B = Module._malloc(8)
          const x1B = Module._malloc(8)
          const y1B = Module._malloc(8)

          try {
            for (let j = 0; j < numArcs; j++) {
              _topo_get_route_arc(
                ptr,
                i,
                j,
                cxB,
                cyB,
                rB,
                dirB,
                x0B,
                y0B,
                x1B,
                y1B,
              )
              arcs.push({
                cx: Module.getValue(cxB, "double") / scale + bounds.minX,
                cy: Module.getValue(cyB, "double") / scale + bounds.minY,
                r: Module.getValue(rB, "double") / scale,
                dir: Module.getValue(dirB, "i32"),
                x0: Module.getValue(x0B, "double") / scale + bounds.minX,
                y0: Module.getValue(y0B, "double") / scale + bounds.minY,
                x1: Module.getValue(x1B, "double") / scale + bounds.minX,
                y1: Module.getValue(y1B, "double") / scale + bounds.minY,
              })
            }
          } finally {
            Module._free(cxB)
            Module._free(cyB)
            Module._free(rB)
            Module._free(dirB)
            Module._free(x0B)
            Module._free(y0B)
            Module._free(x1B)
            Module._free(y1B)
          }
        }

        routes.push({ netName, path, arcs })
      }

      // Extract CDT edges for visualization
      const numEdges = _topo_get_num_cdt_edges(ptr) as number
      const cdtEdges: TopoSolveResult["cdtEdges"] = []
      const x1B = Module._malloc(8)
      const y1B = Module._malloc(8)
      const x2B = Module._malloc(8)
      const y2B = Module._malloc(8)
      const icB = Module._malloc(4)

      try {
        for (let i = 0; i < numEdges; i++) {
          _topo_get_cdt_edge(ptr, i, x1B, y1B, x2B, y2B, icB)
          cdtEdges.push({
            v1: {
              x: Module.getValue(x1B, "double") / scale + bounds.minX,
              y: Module.getValue(y1B, "double") / scale + bounds.minY,
            },
            v2: {
              x: Module.getValue(x2B, "double") / scale + bounds.minX,
              y: Module.getValue(y2B, "double") / scale + bounds.minY,
            },
            isConstraint: Module.getValue(icB, "i32") !== 0,
          })
        }
      } finally {
        Module._free(x1B)
        Module._free(y1B)
        Module._free(x2B)
        Module._free(y2B)
        Module._free(icB)
      }

      this.result = { routes, stats, cdtEdges }
      this.stats = {
        ...stats,
        routeCount: routes.length,
        cdtEdgeCount: cdtEdges.length,
      }

      // Bridge routed paths back to original pad centers
      for (const route of routes) {
        if (route.path.length < 2) continue
        const conn = srj.connections.find((c) => c.name === route.netName)
        if (!conn) continue

        for (const pt of conn.pointsToConnect) {
          const orig = originalPositions.get(
            `${conn.name}:${pt.x.toFixed(6)},${pt.y.toFixed(6)}`,
          )
          if (!orig) continue
          const first = route.path[0]
          const last = route.path[route.path.length - 1]
          const distFirst = (first.x - pt.x) ** 2 + (first.y - pt.y) ** 2
          const distLast = (last.x - pt.x) ** 2 + (last.y - pt.y) ** 2

          if (distFirst < distLast && distFirst < 1) {
            route.path.unshift({ x: orig.x, y: orig.y })
          } else if (distLast < 1) {
            route.path.push({ x: orig.x, y: orig.y })
          }
        }
      }

      this.traces = this.convertRoutesToTraces(routes)
    } finally {
      Module._free(xBuf)
      Module._free(yBuf)
      _topo_destroy(ptr)
    }
  }

  private convertRoutesToTraces(
    routes: TopoRouteResult[],
  ): SimplifiedPcbTraces {
    const traceWidth = this.srj.nominalTraceWidth ?? this.srj.minTraceWidth
    const traces: SimplifiedPcbTraces = []

    const connLayerMap = new Map<string, string>()
    for (const conn of this.srj.connections) {
      const layers = conn.pointsToConnect.flatMap((pt) =>
        getConnectionPointLayers(pt),
      )
      connLayerMap.set(conn.name, layers[0] ?? "top")
    }

    for (let i = 0; i < routes.length; i++) {
      const route = routes[i]
      if (route.path.length < 2) continue

      const layer = connLayerMap.get(route.netName) ?? "top"
      const traceRoute: SimplifiedPcbTrace["route"] = []

      if (route.arcs.length > 0) {
        traceRoute.push({
          route_type: "wire",
          x: route.path[0].x,
          y: route.path[0].y,
          width: traceWidth,
          layer,
        })

        for (const arc of route.arcs) {
          // Line to arc start (skip if sentinel values)
          if (arc.x0 !== -1 && arc.y0 !== -1) {
            traceRoute.push({
              route_type: "wire",
              x: arc.x0,
              y: arc.y0,
              width: traceWidth,
              layer,
            })
          }
          // Discretize arc (only if start point is valid)
          if (arc.r > 0 && arc.x0 !== -1 && arc.y0 !== -1) {
            const sa = Math.atan2(arc.y0 - arc.cy, arc.x0 - arc.cx)
            const ea = Math.atan2(arc.y1 - arc.cy, arc.x1 - arc.cx)
            let sweep = ea - sa
            if (arc.dir < 0) {
              if (sweep > 0) sweep -= Math.PI * 2
            } else {
              if (sweep < 0) sweep += Math.PI * 2
            }
            const nSegs = Math.max(
              4,
              Math.ceil((Math.abs(sweep) * arc.r) / 0.5),
            )
            for (let j = 1; j <= nSegs; j++) {
              const t = j / nSegs
              const a = sa + sweep * t
              traceRoute.push({
                route_type: "wire",
                x: arc.cx + arc.r * Math.cos(a),
                y: arc.cy + arc.r * Math.sin(a),
                width: traceWidth,
                layer,
              })
            }
          }
        }

        const lastPt = route.path[route.path.length - 1]
        traceRoute.push({
          route_type: "wire",
          x: lastPt.x,
          y: lastPt.y,
          width: traceWidth,
          layer,
        })
      } else {
        for (const pt of route.path) {
          traceRoute.push({
            route_type: "wire",
            x: pt.x,
            y: pt.y,
            width: traceWidth,
            layer,
          })
        }
      }

      traces.push({
        type: "pcb_trace",
        pcb_trace_id: `toporoute_${i}`,
        connection_name: route.netName,
        route: traceRoute,
      })
    }

    return traces
  }

  getOutputSimplifiedPcbTraces(): SimplifiedPcbTraces {
    if (!this.solved)
      throw new Error("Cannot get output before solving is complete")
    return this.traces
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return { ...this.srj, traces: this.getOutputSimplifiedPcbTraces() }
  }

  visualize(): GraphicsObject {
    const { srj } = this
    const { minX, maxX, minY, maxY } = srj.bounds

    const problemViz: GraphicsObject = {
      points: srj.connections.flatMap((c) =>
        c.pointsToConnect.map((p) => ({
          ...p,
          label: `${c.name} ${("pcb_port_id" in p && p.pcb_port_id) ?? ""}`,
        })),
      ),
      rects: (srj.obstacles ?? []).map((o) => ({
        ...o,
        fill: o.layers?.includes("top")
          ? "rgba(255,0,0,0.25)"
          : o.layers?.includes("bottom")
            ? "rgba(0,0,255,0.25)"
            : "rgba(255,0,0,0.25)",
        label: o.layers?.join(", "),
      })),
      lines: [
        {
          points: [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY },
            { x: minX, y: minY },
          ],
          strokeColor: "rgba(255,0,0,0.25)",
        },
      ],
    }

    if (!this.result) return problemViz

    const cdtLines: Line[] = this.result.cdtEdges.map((e) => ({
      points: [e.v1, e.v2],
      strokeColor: e.isConstraint
        ? "rgba(255,68,170,0.3)"
        : "rgba(40,50,70,0.3)",
    }))

    const routeLines: Line[] = this.result.routes.map((r) => ({
      points: r.path,
      strokeColor: this.colorMap[r.netName] ?? "rgba(0,255,0,0.7)",
    }))

    const routeViz: GraphicsObject = { lines: [...cdtLines, ...routeLines] }

    if (this.solved) {
      return combineVisualizations(
        problemViz,
        routeViz,
        convertSrjToGraphicsObject(this.getOutputSimpleRouteJson()),
      )
    }
    return combineVisualizations(problemViz, routeViz)
  }

  preview(): GraphicsObject {
    if (!this.result) return {}
    return {
      lines: this.result.routes.map((r) => ({
        points: r.path,
        strokeColor: this.colorMap[r.netName] ?? "rgba(0,255,0,0.7)",
      })),
    }
  }
}
