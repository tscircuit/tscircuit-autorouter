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

import type { GraphicsObject, Line, Point, Rect } from "graphics-debug"
import { BaseSolver } from "../../solvers/BaseSolver"
import type {
  SimpleRouteJson,
  SimplifiedPcbTraces,
  SimplifiedPcbTrace,
  Obstacle,
  SimpleRouteConnection,
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
      // Dynamic import of the emscripten glue JS
      const wasmJsUrl = new URL("./wasm/toporouter.js", import.meta.url).href
      const wasmUrl = new URL("./wasm/toporouter.wasm", import.meta.url).href

      // Fetch and evaluate the module factory
      const response = await fetch(wasmJsUrl)
      const jsCode = await response.text()

      // The emscripten module is a factory function called ToporouterModule
      const factory = new Function(`${jsCode}; return ToporouterModule;`)()
      wasmModule = await factory({
        locateFile: (path: string) => {
          if (path.endsWith(".wasm")) return wasmUrl
          return path
        },
      })
      return wasmModule
    })()
  }

  return wasmModulePromise
}

function getConnectionPointLayers(
  pt: ConnectionPoint,
): string[] {
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

  _step() {
    if (this.phase === "loading") {
      if (!this.loadingStarted) {
        this.loadingStarted = true
        this.progress = 0.05
        // Start async WASM loading, then solve synchronously
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
    // Waiting for async solve to complete
  }

  private solveWithWasm(Module: any) {
    const { srj } = this
    const bounds = srj.bounds
    const bw = bounds.maxX - bounds.minX
    const bh = bounds.maxY - bounds.minY

    // Scale to internal toporouter units (100x for precision)
    const scale = 100

    const _topo_create = Module.cwrap("topo_create", "number", [
      "number",
      "number",
    ])
    const _topo_destroy = Module.cwrap("topo_destroy", null, ["number"])
    const _topo_set_trace_width = Module.cwrap("topo_set_trace_width", null, [
      "number",
      "number",
    ])
    const _topo_set_keepaway = Module.cwrap("topo_set_keepaway", null, [
      "number",
      "number",
    ])
    const _topo_set_via_cost = Module.cwrap("topo_set_via_cost", null, [
      "number",
      "number",
    ])
    const _topo_add_obstacle = Module.cwrap("topo_add_obstacle", "number", [
      "number",
      "number",
      "number",
      "number",
      "number",
      "string",
      "number",
    ])
    const _topo_add_connection = Module.cwrap("topo_add_connection", "number", [
      "number",
      "number",
      "number",
      "string",
    ])
    const _topo_solve = Module.cwrap("topo_solve", "number", ["number"])
    const _topo_get_num_routed = Module.cwrap("topo_get_num_routed", "number", [
      "number",
    ])
    const _topo_get_num_failed = Module.cwrap("topo_get_num_failed", "number", [
      "number",
    ])
    const _topo_get_wiring_score = Module.cwrap(
      "topo_get_wiring_score",
      "number",
      ["number"],
    )
    const _topo_get_num_routes = Module.cwrap("topo_get_num_routes", "number", [
      "number",
    ])
    const _topo_get_route_path_len = Module.cwrap(
      "topo_get_route_path_len",
      "number",
      ["number", "number"],
    )
    const _topo_get_route_point = Module.cwrap("topo_get_route_point", null, [
      "number",
      "number",
      "number",
      "number",
      "number",
    ])
    const _topo_get_route_net_name = Module.cwrap(
      "topo_get_route_net_name",
      "string",
      ["number", "number"],
    )
    const _topo_get_route_num_arcs = Module.cwrap(
      "topo_get_route_num_arcs",
      "number",
      ["number", "number"],
    )
    const _topo_get_route_arc = Module.cwrap("topo_get_route_arc", null, [
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
    const _topo_get_num_cdt_edges = Module.cwrap(
      "topo_get_num_cdt_edges",
      "number",
      ["number"],
    )
    const _topo_get_cdt_edge = Module.cwrap("topo_get_cdt_edge", null, [
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

    // Add SRJ obstacles as toporouter obstacles
    for (const obs of srj.obstacles) {
      const r = (Math.max(obs.width, obs.height) / 2) * scale
      const x = (obs.center.x - bounds.minX) * scale
      const y = (obs.center.y - bounds.minY) * scale
      const layer = getLayerIndex(obs.layers?.[0] ?? "top")
      const netName =
        obs.connectedTo.length > 0 ? obs.connectedTo[0] : null
      // type: 0=PIN, 1=PAD, 2=VIA, 3=OBSTACLE
      const type = netName ? 1 : 3
      _topo_add_obstacle(ptr, x, y, r, type, netName, layer)
    }

    // Add connection points as pin obstacles and connect them
    const pointObsIds = new Map<string, number>()

    for (const conn of srj.connections) {
      const ptIds: number[] = []

      for (const pt of conn.pointsToConnect) {
        const ptKey = `${pt.x.toFixed(6)},${pt.y.toFixed(6)}`
        let obsId: number = pointObsIds.get(ptKey) ?? -1

        if (obsId === -1) {
          const x = (pt.x - bounds.minX) * scale
          const y = (pt.y - bounds.minY) * scale
          const layers = getConnectionPointLayers(pt)
          const layer = getLayerIndex(layers[0])
          obsId = _topo_add_obstacle(
            ptr,
            x,
            y,
            tw / 2,
            0,
            conn.name,
            layer,
          ) as number
          pointObsIds.set(ptKey, obsId)
        }
        ptIds.push(obsId)
      }

      // Connect consecutive points in the connection
      for (let i = 0; i < ptIds.length - 1; i++) {
        _topo_add_connection(ptr, ptIds[i], ptIds[i + 1], conn.name)
      }
    }

    // Solve
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

    // Convert routes to SimplifiedPcbTraces
    this.traces = this.convertRoutesToTraces(routes)
  }

  private convertRoutesToTraces(
    routes: TopoRouteResult[],
  ): SimplifiedPcbTraces {
    const traceWidth = this.srj.nominalTraceWidth ?? this.srj.minTraceWidth
    const traces: SimplifiedPcbTraces = []

    // Find which layer each connection belongs to
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
        // Use arc-based smooth path
        traceRoute.push({
          route_type: "wire",
          x: route.path[0].x,
          y: route.path[0].y,
          width: traceWidth,
          layer,
        })

        for (const arc of route.arcs) {
          // Line to arc start
          if (arc.x0 !== -1 && arc.y0 !== -1) {
            traceRoute.push({
              route_type: "wire",
              x: arc.x0,
              y: arc.y0,
              width: traceWidth,
              layer,
            })
          }

          // Discretize arc into line segments
          if (arc.r > 0) {
            const sa = Math.atan2(arc.y0 - arc.cy, arc.x0 - arc.cx)
            const ea = Math.atan2(arc.y1 - arc.cy, arc.x1 - arc.cx)
            let sweep = ea - sa
            if (arc.dir < 0) {
              if (sweep > 0) sweep -= Math.PI * 2
            } else {
              if (sweep < 0) sweep += Math.PI * 2
            }
            const nSegs = Math.max(4, Math.ceil((Math.abs(sweep) * arc.r) / 0.5))
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

        // Line to end
        const lastPt = route.path[route.path.length - 1]
        traceRoute.push({
          route_type: "wire",
          x: lastPt.x,
          y: lastPt.y,
          width: traceWidth,
          layer,
        })
      } else {
        // Simple path
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

    const problemLines: Line[] = [
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
    ]

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
      lines: problemLines,
    }

    if (!this.result) return problemViz

    // CDT edges
    const cdtLines: Line[] = this.result.cdtEdges.map((e) => ({
      points: [e.v1, e.v2],
      strokeColor: e.isConstraint
        ? "rgba(255,68,170,0.3)"
        : "rgba(40,50,70,0.3)",
    }))

    // Route lines
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
