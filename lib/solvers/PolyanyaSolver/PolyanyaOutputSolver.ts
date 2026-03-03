import type { GraphicsObject } from "graphics-debug"
import { BaseSolver } from "../BaseSolver"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "../../types"
import type { HighDensityIntraNodeRoute } from "../../types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "../../utils/convertHdRouteToSimplifiedRoute"
import type { ResolvedPath } from "./types"

export class PolyanyaOutputSolver extends BaseSolver {
  resolvedPaths: ResolvedPath[]
  srj: SimpleRouteJson
  minTraceWidth: number
  viaDiameter: number
  hdRoutes: HighDensityIntraNodeRoute[] = []
  simplifiedTraces: SimplifiedPcbTraces = []

  constructor(params: {
    resolvedPaths: ResolvedPath[]
    srj: SimpleRouteJson
    minTraceWidth: number
    viaDiameter: number
  }) {
    super()
    this.resolvedPaths = params.resolvedPaths
    this.srj = params.srj
    this.minTraceWidth = params.minTraceWidth
    this.viaDiameter = params.viaDiameter
  }

  _step() {
    // Convert each ResolvedPath → HighDensityIntraNodeRoute
    this.hdRoutes = this.resolvedPaths.map((resolved) => ({
      connectionName: resolved.connectionName,
      traceThickness: this.minTraceWidth,
      viaDiameter: this.viaDiameter,
      route: resolved.route.map((p) => ({ x: p.x, y: p.y, z: p.z })),
      vias: resolved.vias.map((v) => ({ x: v.x, y: v.y })),
    }))

    // Convert HD routes → SimplifiedPcbTraces
    this.simplifiedTraces = this.hdRoutes.map((hdRoute, i) => {
      const conn = this.srj.connections.find(
        (c) => c.name === hdRoute.connectionName,
      )
      return {
        type: "pcb_trace" as const,
        pcb_trace_id: `${hdRoute.connectionName}_${i}`,
        connection_name:
          conn?.netConnectionName ??
          conn?.rootConnectionName ??
          hdRoute.connectionName,
        route: convertHdRouteToSimplifiedRoute(hdRoute, this.srj.layerCount),
      }
    })

    this.solved = true
  }

  getHdRoutes(): HighDensityIntraNodeRoute[] {
    return this.hdRoutes
  }

  getSimplifiedTraces(): SimplifiedPcbTraces {
    return this.simplifiedTraces
  }

  visualize(): GraphicsObject {
    const lines: GraphicsObject["lines"] = []

    for (const hdRoute of this.hdRoutes) {
      if (hdRoute.route.length > 1) {
        lines.push({
          points: hdRoute.route.map((p) => ({ x: p.x, y: p.y })),
          strokeColor: "rgba(0,200,0,0.8)",
          strokeWidth: this.minTraceWidth,
        })
      }
    }

    return { lines }
  }
}
