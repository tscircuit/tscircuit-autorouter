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
        // Node/bun environment — read from filesystem
        const fs = await import("fs")
        jsCode = fs.readFileSync(wasmJsUrl, "utf-8")
        wasmBinary = fs.readFileSync(wasmUrl).buffer as ArrayBuffer
      } else {
        // Browser environment — use fetch
        const [jsResp, wasmResp] = await Promise.all([
          fetch(wasmJsUrl.href),
          fetch(wasmUrl.href),
        ])
        jsCode = await jsResp.text()
        wasmBinary = await wasmResp.arrayBuffer()
      }

      const factory = new Function(`${jsCode}; return ToporouterModule;`)()
      wasmModule = await factory({ wasmBinary })
      return wasmModule
    })()
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
  if (m) return Number.parseInt(m[1]) + 1
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
    const scale = 100

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

    const tw = (srj.nominalTraceWidth ?? srj.minTraceWidth) * scale
    const ka = (srj.defaultObstacleMargin ?? srj.minTraceWidth / 2) * scale
    _topo_set_trace_width(ptr, tw)
    _topo_set_keepaway(ptr, ka)
    _topo_set_via_cost(ptr, 10000)

    // Add ALL SRJ obstacles as blockers to the toporouter.
    for (const obs of srj.obstacles) {
      const r = (Math.max(obs.width, obs.height) / 2) * scale
      const x = (obs.center.x - bounds.minX) * scale
      const y = (obs.center.y - bounds.minY) * scale
      const layer = getLayerIndex(obs.layers?.[0] ?? "top")
      _topo_add_obstacle(ptr, x, y, r, 3, null, layer)
    }

    // For connection endpoints that land inside an obstacle (+ keepaway),
    // nudge them to just outside so the CDT router can reach them.
    // After routing, we bridge back from the nudged point to the original.
    const nudgeMargin = ka + tw // clear of obstacle + keepaway + trace width
    const originalPositions = new Map<string, { x: number; y: number }>()

    function nudgePoint(px: number, py: number): { x: number; y: number } {
      // Iteratively nudge out of all obstacles
      for (let iter = 0; iter < 5; iter++) {
        let nudged = false
        for (const obs of srj.obstacles) {
          const hw = (obs.width / 2) * scale + nudgeMargin
          const hh = (obs.height / 2) * scale + nudgeMargin
          const ox = (obs.center.x - bounds.minX) * scale
          const oy = (obs.center.y - bounds.minY) * scale

          if (px > ox - hw && px < ox + hw && py > oy - hh && py < oy + hh) {
            const dLeft = px - (ox - hw)
            const dRight = ox + hw - px
            const dTop = py - (oy - hh)
            const dBottom = oy + hh - py
            const dMin = Math.min(dLeft, dRight, dTop, dBottom)

            if (dMin === dLeft) px = ox - hw - 1
            else if (dMin === dRight) px = ox + hw + 1
            else if (dMin === dTop) py = oy - hh - 1
            else py = oy + hh + 1
            nudged = true
          }
        }
        if (!nudged) break
      }
      // Clamp to board bounds
      px = Math.max(nudgeMargin, Math.min(bw * scale - nudgeMargin, px))
      py = Math.max(nudgeMargin, Math.min(bh * scale - nudgeMargin, py))
      return { x: px, y: py }
    }

    // Add connection points as pin-type obstacles at nudged positions.
    const pointObsIds = new Map<string, number>()

    for (const conn of srj.connections) {
      const ptIds: number[] = []

      for (const pt of conn.pointsToConnect) {
        const ptKey = `${pt.x.toFixed(6)},${pt.y.toFixed(6)}`
        let obsId: number = pointObsIds.get(ptKey) ?? -1

        if (obsId === -1) {
          const rawX = (pt.x - bounds.minX) * scale
          const rawY = (pt.y - bounds.minY) * scale
          const nudged = nudgePoint(rawX, rawY)
          const layers = getConnectionPointLayers(pt)
          const layer = getLayerIndex(layers[0])

          // Remember original position for bridging
          originalPositions.set(ptKey, {
            x: pt.x,
            y: pt.y,
          })

          obsId = _topo_add_obstacle(
            ptr,
            nudged.x,
            nudged.y,
            tw / 4,
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
    const xBuf = Module._malloc(8)
    const yBuf = Module._malloc(8)

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

        for (let j = 0; j < numArcs; j++) {
          _topo_get_route_arc(ptr, i, j, cxB, cyB, rB, dirB, x0B, y0B, x1B, y1B)
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

        Module._free(cxB)
        Module._free(cyB)
        Module._free(rB)
        Module._free(dirB)
        Module._free(x0B)
        Module._free(y0B)
        Module._free(x1B)
        Module._free(y1B)
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

    Module._free(x1B)
    Module._free(y1B)
    Module._free(x2B)
    Module._free(y2B)
    Module._free(icB)
    Module._free(xBuf)
    Module._free(yBuf)

    _topo_destroy(ptr)

    this.result = { routes, stats, cdtEdges }
    this.stats = {
      ...stats,
      routeCount: routes.length,
      cdtEdgeCount: cdtEdges.length,
    }
    // Bridge routed paths back to original pad centers.
    // The router used nudged endpoints; now prepend/append a short
    // wire segment from the original position to the nudged position.
    for (const route of routes) {
      if (route.path.length < 2) continue
      const conn = srj.connections.find((c) => c.name === route.netName)
      if (!conn) continue

      // Find the original position for the start point
      for (const pt of conn.pointsToConnect) {
        const orig = originalPositions.get(
          `${pt.x.toFixed(6)},${pt.y.toFixed(6)}`,
        )
        if (!orig) continue
        const first = route.path[0]
        const last = route.path[route.path.length - 1]
        const distFirst = (first.x - pt.x) ** 2 + (first.y - pt.y) ** 2
        const distLast = (last.x - pt.x) ** 2 + (last.y - pt.y) ** 2

        // Bridge to the closest endpoint
        if (
          distFirst < distLast &&
          distFirst < 1 // only if close (same point, nudged)
        ) {
          route.path.unshift({ x: orig.x, y: orig.y })
        } else if (distLast < 1) {
          route.path.push({ x: orig.x, y: orig.y })
        }
      }
    }

    this.traces = this.convertRoutesToTraces(routes)
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
          if (arc.x0 !== -1 && arc.y0 !== -1) {
            traceRoute.push({
              route_type: "wire",
              x: arc.x0,
              y: arc.y0,
              width: traceWidth,
              layer,
            })
          }
          if (arc.r > 0) {
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
    if (!this.solved) {
      throw new Error("Cannot get output before solving is complete")
    }
    return this.traces
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    return {
      ...this.srj,
      traces: this.getOutputSimplifiedPcbTraces(),
    }
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

    const routeViz: GraphicsObject = {
      lines: [...cdtLines, ...routeLines],
    }

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
    const lines: Line[] = this.result.routes.map((r) => ({
      points: r.path,
      strokeColor: this.colorMap[r.netName] ?? "rgba(0,255,0,0.7)",
    }))
    return { lines }
  }
}
