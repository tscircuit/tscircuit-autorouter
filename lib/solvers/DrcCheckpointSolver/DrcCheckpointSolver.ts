import type { DrcEvaluator } from "high-density-repair03/lib"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { BaseSolver } from "../BaseSolver"

type DrcCheckpointSolverParams = {
  baselineHdRoutes: HighDensityRoute[]
  candidateHdRoutes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
}

type DrcCheckpointDecision = {
  baselineDrcCount: number
  candidateDrcCount: number
  accepted: boolean
}

const addRoutesToGraphics = ({
  graphics,
  routes,
  color,
  label,
  step,
}: {
  graphics: GraphicsObject
  routes: HighDensityRoute[]
  color: string
  label: string
  step: number
}): void => {
  for (const route of routes) {
    for (
      let pointIndex = 0;
      pointIndex < route.route.length - 1;
      pointIndex++
    ) {
      const start = route.route[pointIndex]!
      const end = route.route[pointIndex + 1]!
      graphics.lines!.push({
        points: [
          { x: start.x, y: start.y },
          { x: end.x, y: end.y },
        ],
        strokeColor: color,
        strokeDash: start.z === end.z && start.z !== 0 ? [0.1, 0.1] : undefined,
        strokeWidth: route.traceThickness,
        label: `${label}: ${route.connectionName}`,
        step,
      })
    }

    for (const via of route.vias) {
      graphics.circles!.push({
        center: { x: via.x, y: via.y },
        radius: route.viaDiameter / 2,
        fill: color,
        label: `${label} via: ${route.connectionName}`,
        step,
      })
    }
  }
}

export class DrcCheckpointSolver extends BaseSolver {
  readonly params: DrcCheckpointSolverParams
  outputHdRoutes: HighDensityRoute[]
  decision?: DrcCheckpointDecision

  constructor(params: DrcCheckpointSolverParams) {
    super()
    this.params = params
    this.outputHdRoutes = params.baselineHdRoutes
    this.MAX_ITERATIONS = 1
  }

  override getSolverName(): string {
    return "DrcCheckpointSolver"
  }

  override getConstructorParams(): readonly [DrcCheckpointSolverParams] {
    return [this.params]
  }

  override _step(): void {
    const baselineDrcResult = this.params.drcEvaluator({
      routes: this.params.baselineHdRoutes,
      traces: [],
    })
    const baselineDrcCount = Array.isArray(baselineDrcResult)
      ? baselineDrcResult.length
      : baselineDrcResult.errors.length
    const candidateDrcResult = this.params.drcEvaluator({
      routes: this.params.candidateHdRoutes,
      traces: [],
    })
    const candidateDrcCount = Array.isArray(candidateDrcResult)
      ? candidateDrcResult.length
      : candidateDrcResult.errors.length
    const accepted = candidateDrcCount <= baselineDrcCount
    this.decision = {
      baselineDrcCount,
      candidateDrcCount,
      accepted,
    }

    this.outputHdRoutes = accepted
      ? this.params.candidateHdRoutes
      : this.params.baselineHdRoutes
    this.stats = this.decision
    this.solved = true
    this.progress = 1
  }

  getOutput(): HighDensityRoute[] {
    return this.outputHdRoutes
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
      texts: [],
      coordinateSystem: "cartesian",
      title: "Post-DRC Via Optimization Checkpoint",
    }
    const decision = this.decision
    const baselineAnchor = this.params.baselineHdRoutes[0]?.route[0] ?? {
      x: 0,
      y: 0,
    }
    const candidateAnchor =
      this.params.candidateHdRoutes[0]?.route[0] ?? baselineAnchor
    const outputAnchor = this.outputHdRoutes[0]?.route[0] ?? candidateAnchor

    addRoutesToGraphics({
      graphics,
      routes: this.params.baselineHdRoutes,
      color: "rgba(220, 38, 38, 0.65)",
      label: "Pre-optimization baseline",
      step: 1,
    })
    graphics.texts!.push({
      x: baselineAnchor.x,
      y: baselineAnchor.y,
      text: `Baseline DRC errors: ${decision?.baselineDrcCount ?? "not evaluated"}`,
      color: "#b91c1c",
      step: 1,
    })

    addRoutesToGraphics({
      graphics,
      routes: this.params.candidateHdRoutes,
      color: "rgba(217, 119, 6, 0.7)",
      label: "Via-optimized candidate",
      step: 2,
    })
    graphics.texts!.push({
      x: candidateAnchor.x,
      y: candidateAnchor.y,
      text: `Candidate DRC errors: ${decision?.candidateDrcCount ?? "not evaluated"}`,
      color: "#b45309",
      step: 2,
    })

    addRoutesToGraphics({
      graphics,
      routes: this.outputHdRoutes,
      color: "#16a34a",
      label: decision?.accepted ? "Accepted candidate" : "Retained baseline",
      step: 3,
    })
    graphics.texts!.push({
      x: outputAnchor.x,
      y: outputAnchor.y,
      text: decision?.accepted
        ? "Decision: accept candidate (DRC did not increase)"
        : "Decision: reject candidate (DRC increased)",
      color: "#15803d",
      step: 3,
    })

    return graphics
  }
}
