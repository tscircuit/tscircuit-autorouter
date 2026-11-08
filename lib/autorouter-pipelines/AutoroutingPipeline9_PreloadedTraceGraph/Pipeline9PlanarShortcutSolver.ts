import { FindClearancePathSolver } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { preparePipeline9RepairConnectivity } from "./preparePipeline9RepairConnectivity"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

export type PlanarShortcutParams = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  otherRoutes: HighDensityRoute[]
  connMap: ConnectivityMap
  effort: number
  viaHoleDiameter: number
  isValid: (routes: HighDensityRoute[]) => boolean
}

/** Search around pad corners when straight-line via removal cannot do so. */
export class Pipeline9PlanarShortcutSolver extends BaseSolver {
  readonly params: PlanarShortcutParams
  routes: HighDensityRoute[]
  search?: FindClearancePathSolver
  private readonly candidates: number[]
  private cursor = 0
  private nodesPopped = 0
  private accepted = 0

  constructor(params: PlanarShortcutParams) {
    super()
    this.params = params
    this.routes = structuredClone(params.routes)
    this.candidates = this.routes
      .flatMap((route, index) =>
        (route.vias.length >= 2 ||
          this.planarLength(route) >
            1.5 *
              Math.hypot(
                route.route[0]!.x - route.route.at(-1)!.x,
                route.route[0]!.y - route.route.at(-1)!.y,
              )) &&
        !route.jumpers?.length &&
        route.route[0]?.z === route.route.at(-1)?.z
          ? [index]
          : [],
      )
      .sort(
        (a, b) =>
          this.planarLength(this.routes[a]!) -
          this.planarLength(this.routes[b]!),
      )
    this.MAX_ITERATIONS = 1e7
  }

  private planarLength(route: HighDensityRoute): number {
    return route.route.reduce((length, point, index) => {
      const previous = route.route[index - 1]
      return (
        length +
        (previous ? Math.hypot(point.x - previous.x, point.y - previous.y) : 0)
      )
    }, 0)
  }

  override _step(): void {
    const routeIndex = this.candidates[this.cursor]
    const remaining = Math.ceil(50000 * this.params.effort) - this.nodesPopped
    if (routeIndex === undefined || remaining <= 0) {
      this.solved = true
      this.stats = {
        searches: this.cursor,
        nodesPopped: this.nodesPopped,
        accepted: this.accepted,
      }
      return
    }
    const route = this.routes[routeIndex]!
    if (!this.search) {
      const start = route.route[0]!
      const end = route.route.at(-1)!
      const padding = Math.max(
        0.5,
        Math.min(2, Math.hypot(end.x - start.x, end.y - start.y) / 2),
      )
      const { srj } = this.params
      const prepared = preparePipeline9RepairConnectivity({
        srj,
        routes: [...this.routes, ...this.params.otherRoutes],
        connMap: this.params.connMap,
      })
      this.search = new FindClearancePathSolver({
        srj: { ...prepared.srj, traces: undefined },
        routes: prepared.routes,
        routeIndex,
        start,
        end,
        bounds: {
          minX: Math.max(srj.bounds.minX, Math.min(start.x, end.x) - padding),
          maxX: Math.min(srj.bounds.maxX, Math.max(start.x, end.x) + padding),
          minY: Math.max(srj.bounds.minY, Math.min(start.y, end.y) - padding),
          maxY: Math.min(srj.bounds.maxY, Math.max(start.y, end.y) + padding),
        },
        traceThickness: Math.max(
          route.traceThickness,
          ...route.route.map((p) => p.traceThickness ?? route.traceThickness),
        ),
        traceClearance:
          srj.minTraceToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0.1,
        viaClearance: srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1,
        viaHoleDiameter: this.params.viaHoleDiameter,
        allowLayerChanges: false,
        gridSize: Math.max(0.025, srj.minTraceWidth / 2),
        maxNodes: Math.min(remaining, Math.ceil(5000 * this.params.effort)),
      })
    }
    this.search.step()
    if (this.search.failed)
      throw new Error(this.search.error ?? "Planar via search failed")
    if (!this.search.solved) return
    this.nodesPopped += this.search.stats.nodesPopped
    const path = this.search.getOutput()
    if (path) {
      const candidate = [...this.routes]
      const replacement = { ...route, route: path, vias: [] }
      // Removing vias must not increase planar length or lose a copper branch.
      if (
        this.planarLength(replacement) < this.planarLength(route) - 1e-6 ||
        (route.vias.length > 0 &&
          this.planarLength(replacement) <= this.planarLength(route) + 1e-9)
      ) {
        candidate[routeIndex] = replacement
        if (this.params.isValid(candidate)) {
          this.routes = candidate
          this.accepted++
        }
      }
    }
    this.cursor++
    this.search = undefined
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved) throw new Error("Planar via cleanup is not complete")
    return this.routes
  }
}
