import { SingleSimplifiedPathSolver5, VertexShortcutPathSolver } from "@tscircuit/trace-simplification-solver"
import { BaseSolver } from "./BaseSolver"

type ShortcutOptions = ConstructorParameters<typeof VertexShortcutPathSolver>[0]
type Route = ShortcutOptions["inputRoute"]

export class RepairedTraceSimplificationSolver extends BaseSolver {
  simplifiedHdRoutes: Route[] = []
  activeSubSolver: SingleSimplifiedPathSolver5 | null = null
  private pointIndex = 0
  private sectionEnd = 0
  private sectionPoints: Route["route"] = []
  private repairedPoints: Route["route"] = []

  constructor(
    private readonly options: Omit<ShortcutOptions, "inputRoute" | "otherHdRoutes"> & {
      unsimplifiedHdRoutes: Route[]
    },
  ) {
    super()
    this.MAX_ITERATIONS = 100e6
  }

  _step(): void {
    const routeIndex = this.simplifiedHdRoutes.length
    const route = this.options.unsimplifiedHdRoutes[routeIndex]
    if (!route) {
      this.solved = true
      return
    }
    // Keep width tapers intact; their geometry was sized for the terminal pads.
    if (route.route.some((point) =>
      point.traceThickness !== undefined && point.traceThickness !== route.traceThickness
    )) {
      this.simplifiedHdRoutes.push(route)
      return
    }
    if (this.activeSubSolver) {
      this.activeSubSolver.step()
      if (this.activeSubSolver.failed) {
        this.failed = true
        this.error = this.activeSubSolver.error
      } else if (this.activeSubSolver.solved) {
        if (!(this.activeSubSolver instanceof VertexShortcutPathSolver)) {
          this.activeSubSolver = new VertexShortcutPathSolver({
            ...this.options,
            inputRoute: this.activeSubSolver.simplifiedRoute,
            otherHdRoutes: this.activeSubSolver.otherHdRoutes,
          })
          return
        }
        const points = this.activeSubSolver.simplifiedRoute.route
        const width = this.sectionPoints[0].traceThickness ?? route.traceThickness
        this.repairedPoints.push(
          this.sectionPoints[0],
          ...points.slice(1, -1).map((point) => ({ ...point, traceThickness: width })),
        )
        this.pointIndex = this.sectionEnd
        this.activeSubSolver = null
      }
      return
    }
    const start = route.route[this.pointIndex]
    if (this.pointIndex >= route.route.length - 1) {
      if (start) this.repairedPoints.push(start)
      this.simplifiedHdRoutes.push({ ...route, route: this.repairedPoints })
      this.pointIndex = 0
      this.repairedPoints = []
      return
    }
    const next = route.route[this.pointIndex + 1]
    // Simplify each layer separately so drilled via positions cannot move.
    if (start.z !== next.z || start.toNextSegmentType || start.insideJumperPad) {
      this.repairedPoints.push(start)
      this.pointIndex++
      return
    }
    const width = start.traceThickness ?? route.traceThickness
    this.sectionEnd = this.pointIndex + 1
    while (this.sectionEnd < route.route.length - 1) {
      const point = route.route[this.sectionEnd]
      const after = route.route[this.sectionEnd + 1]
      if (point.z !== after.z || point.pcb_port_id || point.toNextSegmentType ||
          point.insideJumperPad) break
      this.sectionEnd++
    }
    this.sectionPoints = route.route.slice(this.pointIndex, this.sectionEnd + 1)
    this.activeSubSolver = new SingleSimplifiedPathSolver5({
      ...this.options,
      inputRoute: { ...route, traceThickness: width, route: this.sectionPoints, vias: [] },
      otherHdRoutes: this.simplifiedHdRoutes.concat(
        this.options.unsimplifiedHdRoutes.slice(routeIndex + 1),
      ),
    })
  }
}
