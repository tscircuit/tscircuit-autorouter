import { MultiSimplifiedPathSolver } from "@tscircuit/trace-simplification-solver"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"

type PathParams = ConstructorParameters<typeof MultiSimplifiedPathSolver>[0]
type Route = PathParams["unsimplifiedHdRoutes"][number]
type RoutePoint = Route["route"][number]
type Section = {
  routeIndex: number
  points: RoutePoint[]
  pathIndex: number | null
  width: number
}
type Partition = { sections: Section[]; paths: Route[]; fixedCopper: Route[] }

/** Path sampling is a same-layer operation; vias and identity anchors delimit it. */
const partitionRoutes = (routes: Route[]): Partition => {
  const partition: Partition = { sections: [], paths: [], fixedCopper: [] }
  const addSection = (routeIndex: number, points: RoutePoint[], fixed: boolean): void => {
    const original = routes[routeIndex]!
    const first = points[0]!
    const coincident = points.every((point) => point.x === first.x && point.y === first.y && point.z === first.z)
    const pathIndex = fixed || points.length < 2 || coincident ? null : partition.paths.length
    const width = Math.max(...points.map((point) => point.traceThickness ?? original.traceThickness))
    partition.sections.push({ routeIndex, points, pathIndex, width })
    if (pathIndex !== null) {
      partition.paths.push({ ...original, traceThickness: width, route: points.map((point) => ({ ...point })), vias: [] })
    } else if (points.length > 1) {
      partition.fixedCopper.push({ ...original, route: points.map((point) => ({ ...point })), vias: [] })
    }
  }
  for (const [routeIndex, route] of routes.entries()) {
    const first = route.route[0]
    if (!first) throw new Error(`Pipeline9 path simplification received empty route "${route.connectionName}"`)
    // These peers keep foreign vias and jumper pads in the geometry index after
    // their editable wire runs have been split into separate sections.
    if (route.vias.length > 0 || route.jumpers?.length) {
      partition.fixedCopper.push({ ...route, route: [], vias: route.vias.map((via) => ({ ...via })) })
    }
    let points: RoutePoint[] = [first]
    for (let index = 1; index < route.route.length; index++) {
      const previous = route.route[index - 1]!, point = route.route[index]!
      const throughObstacle = previous.toNextSegmentType === "through_obstacle"
      if (previous.z !== point.z || throughObstacle) {
        if (!throughObstacle && (previous.x !== point.x || previous.y !== point.y)) {
          throw new Error(`Pipeline9 path simplification received a non-colocated layer transition in "${route.connectionName}" at point ${index}`)
        }
        addSection(routeIndex, points, false)
        addSection(routeIndex, [previous, point], true)
        points = [point]
        continue
      }
      points.push(point)
      const next = route.route[index + 1]
      const hasIdentity = Object.keys(point).some((key) => key !== "x" && key !== "y" && key !== "z" && key !== "traceThickness")
      const widthChanges = next !== undefined &&
        Math.max(previous.traceThickness ?? route.traceThickness, point.traceThickness ?? route.traceThickness) !==
        Math.max(point.traceThickness ?? route.traceThickness, next.traceThickness ?? route.traceThickness)
      // Preserve wide peaks and plateau ends, without locking every point in a
      // constant-width run merely because its width was explicitly annotated.
      const widthAnchor = next !== undefined && (point.traceThickness ?? route.traceThickness) >
        Math.min(previous.traceThickness ?? route.traceThickness, next.traceThickness ?? route.traceThickness)
      if (next && (hasIdentity || widthChanges || widthAnchor)) {
        addSection(routeIndex, points, false)
        points = [point]
      }
    }
    addSection(routeIndex, points, false)
  }
  return partition
}

/** Reuses the existing path optimizer without letting its sampling step cross a via. */
export class Pipeline9LayerPreservingPathSolver extends MultiSimplifiedPathSolver {
  private readonly originalRoutes: Route[]
  private readonly sections: Section[]

  constructor(params: PathParams) {
    const canonicalRoutes = canonicalizePipeline9HdRoutes(params.unsimplifiedHdRoutes)
    const partition = partitionRoutes(canonicalRoutes)
    super({
      ...params,
      unsimplifiedHdRoutes: partition.paths,
      otherHdRoutes: [...(params.otherHdRoutes ?? []), ...partition.fixedCopper],
    })
    this.originalRoutes = canonicalRoutes
    this.sections = partition.sections
  }

  override _step(): void {
    super._step()
    if (this.activeSubSolver?.failed) {
      if (!this.activeSubSolver.error) throw new Error("Pipeline9 path section failed without an error")
      this.failed = true
      this.error = this.activeSubSolver.error
      this.solved = false
      return
    }
    if (!this.solved) return
    this.solved = false
    if (this.simplifiedHdRoutes.length !== this.unsimplifiedHdRoutes.length) {
      throw new Error("Pipeline9 path simplification changed the anchored section count")
    }
    const merged = this.originalRoutes.map((route): Route => ({
      ...route, route: [], vias: route.vias.map((via) => ({ ...via })),
    }))
    const previousAnchor: Array<RoutePoint | undefined> = this.originalRoutes.map(() => undefined)
    for (const section of this.sections) {
      const original = this.originalRoutes[section.routeIndex]!
      const path = section.pathIndex === null ? null : this.simplifiedHdRoutes[section.pathIndex]
      if (section.pathIndex !== null && (!path || path.connectionName !== original.connectionName ||
        path.rootConnectionName !== original.rootConnectionName)) {
        throw new Error("Pipeline9 path simplification changed an anchored section's owner")
      }
      const output = section.pathIndex === null
        ? section.points
        : path!.route
      if (!output?.length) throw new Error("Pipeline9 path simplification lost an anchored section")
      const optimized = section.pathIndex === null ? output : output.filter((point, index) => {
        const previous = output[index - 1]
        return !previous || point.x !== previous.x || point.y !== previous.y || point.z !== previous.z
      })
      const expectedStart = section.points[0]!, expectedEnd = section.points.at(-1)!
      const start = optimized[0]!, end = optimized.at(-1)!
      if (start.x !== expectedStart.x || start.y !== expectedStart.y || start.z !== expectedStart.z ||
        end.x !== expectedEnd.x || end.y !== expectedEnd.y || end.z !== expectedEnd.z) {
        throw new Error(`Pipeline9 path simplification moved an anchored endpoint in "${merged[section.routeIndex]!.connectionName}"`)
      }
      if (section.pathIndex !== null && optimized.some((point) => point.z !== expectedStart.z)) {
        throw new Error("Pipeline9 path simplification changed a section's copper layer")
      }
      if (optimized.length === 2 && Math.max(expectedStart.traceThickness ?? original.traceThickness,
        expectedEnd.traceThickness ?? original.traceThickness) !== section.width) {
        throw new Error("Pipeline9 path simplification lost an anchored edge width")
      }
      const destination = merged[section.routeIndex]!.route
      for (const [index, point] of optimized.entries()) {
        const restored = index === 0 ? expectedStart : index === optimized.length - 1 ? expectedEnd :
          section.width === original.traceThickness ? point : { ...point, traceThickness: section.width }
        if (index === 0 && previousAnchor[section.routeIndex] === expectedStart) continue
        destination.push({ ...restored })
      }
      previousAnchor[section.routeIndex] = expectedEnd
    }
    this.simplifiedHdRoutes = merged
    this.solved = true
  }
}
