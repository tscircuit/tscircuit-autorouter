import type { HighDensityRoute } from "lib/types/high-density-types"
import { calculate45DegreePaths } from "lib/utils/calculate45DegreePaths"
import { SingleSimplifiedPathSolver5 } from "./SingleSimplifiedPathSolver5_Deg45"

type RoutePoint = HighDensityRoute["route"][number]

/** Searches existing vertices without stopping at the first blocked shortcut. */
export class VertexShortcutPathSolver extends SingleSimplifiedPathSolver5 {
  private vertexIndex = 0

  constructor(
    params: ConstructorParameters<typeof SingleSimplifiedPathSolver5>[0],
  ) {
    super(params)
    this.newRoute = this.inputRoute.route
      .slice(0, 1)
      .map((point) => ({ ...point }))
    this.newVias = this.inputRoute.vias.map((via) => ({ ...via }))
  }

  override getSolverName(): string {
    return "VertexShortcutPathSolver"
  }

  override _step(): void {
    const points = this.inputRoute.route
    const start = points[this.vertexIndex]
    if (this.vertexIndex >= points.length - 1) {
      this.solved = true
      return
    }

    // Layer transitions, terminals, width changes and jumper pads are anchors.
    let endIndex = this.vertexIndex + 1
    const lengths = [0]
    for (let index = this.vertexIndex; index < points.length - 1; index++) {
      const a = points[index]
      const b = points[index + 1]
      if (
        a.z !== b.z ||
        a.toNextSegmentType ||
        a.traceThickness !== b.traceThickness ||
        (a.traceThickness !== undefined &&
          a.traceThickness !== this.inputRoute.traceThickness) ||
        a.insideJumperPad ||
        b.insideJumperPad
      ) {
        break
      }
      lengths.push(lengths.at(-1)! + Math.hypot(b.x - a.x, b.y - a.y))
      endIndex = index + 1
      if (b.pcb_port_id || this.jumperPadPointIndices.has(endIndex)) break
    }

    for (
      let candidateIndex = endIndex;
      candidateIndex > this.vertexIndex + 1;
      candidateIndex--
    ) {
      const end = points[candidateIndex]
      const originalLength = lengths[candidateIndex - this.vertexIndex]
      for (const path of calculate45DegreePaths(start, end)) {
        const candidate: RoutePoint[] = path
          .filter(
            (point, index) =>
              index === 0 ||
              point.x !== path[index - 1].x ||
              point.y !== path[index - 1].y,
          )
          .map((point) => ({
            ...point,
            z: start.z,
            traceThickness: start.traceThickness,
          }))
        const length = candidate.reduce(
          (sum, point, index) =>
            index === 0
              ? sum
              : sum +
                Math.hypot(
                  point.x - candidate[index - 1].x,
                  point.y - candidate[index - 1].y,
                ),
          0,
        )
        if (
          candidate.length < 2 ||
          length > originalLength + 1e-9 ||
          (length >= originalLength - 1e-9 &&
            candidate.length >= candidateIndex - this.vertexIndex + 1) ||
          !this.isValidPath(candidate)
        ) {
          continue
        }

        // Keep metadata on the endpoint that anchors the next section.
        candidate[candidate.length - 1] = { ...end }
        this.newRoute.push(...candidate.slice(1))
        this.vertexIndex = candidateIndex
        return
      }
    }

    this.vertexIndex++
    this.newRoute.push({ ...points[this.vertexIndex] })
  }
}
