/**
 * Terminology dictionary
 * Point: a route coordinate and its layer.
 * Terminal position: a terminal's route index and point index.
 * Pad: a rectangular conductive obstacle. Route: one routed connection.
 * Net: the canonical connectivity identity shared by connected routes and pads.
 * Terminal: a preserved route endpoint inside a pad.
 * Run: the final straight part of a route approaching its terminal.
 * Run direction: traversal from the terminal toward the route start or end.
 * V: two terminal runs converging at a pad. T: their head and stem replacement.
 * Axis: the stem coordinate; Across: the perpendicular head coordinate.
 * Sign: the outward direction along the axis. Height: the signed head coordinate.
 * Cut: where a run meets the new head; all earlier copper is preserved.
 * Head: the straight connection between the two cuts of a V.
 * Gap: half a trace width of empty space between the head edge and pad edge.
 * Junction: the point on the head directly outside the terminal.
 * Stem: the shared perpendicular connection from junction to terminal.
 *
 * Before                         After
 *   preserved route   route        preserved route   route
 *          \         /                    \         /
 *           \ Run   / Run              Cut o----+----o Cut  <-- Head
 *            \     /                           |
 *          +--\---/--+                 Gap      | Stem
 *          |   \ /   |                     +---|---+
 *          |    o    | Pad                 |   o   | Pad
 *          +---------+                     +-------+
 *            Terminal                       Terminal
 *
 * The + in the Head marks the Junction. The Gap is measured
 * from the copper edge of the Head to the Pad edge, beside the Stem.
 *
 * A V has two converging runs on opposite sides of a cardinal stem axis.
 * Intersect both runs with the nearest head outside the pad, then add the stem.
 * There is one construction, no routing search. Unsupported or blocked Vs stay
 * unchanged. Stages: find V, construct T, check clearance and apply.
 * Route terminals are indexed once by net.
 */
import {
  BasePipelineSolver,
  definePipelineStep,
  type BaseSolver,
  type PipelineStep,
} from "@tscircuit/solver-utils"
import type { GraphicsObject } from "graphics-debug"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  parsePadJunctionInput,
  type PadJunctionSimplificationInput,
} from "./parsePadJunctionInput"
import type {
  PadJunctionContext,
  PadJunctionOutcome,
  AcceptedReplacement,
} from "./padJunctionTypes"
import { getPadNet } from "./getPadNet"
import { FindPadVsSolver } from "./FindPadVsSolver"
import { ConstructPadTsSolver } from "./ConstructPadTsSolver"
import { ApplyPadTsSolver } from "./ApplyPadTsSolver"
import { visualizePadJunctionSimplification } from "./visualizePadJunctionSimplification"
export type { PadJunctionSimplificationInput } from "./parsePadJunctionInput"
export type {
  AcceptedReplacement,
  PadJunctionOutcome,
} from "./padJunctionTypes"

export class PadJunctionSimplificationSolver extends BasePipelineSolver<PadJunctionSimplificationInput> {
  findPadVsSolver!: FindPadVsSolver
  constructPadTsSolver!: ConstructPadTsSolver
  applyPadTsSolver!: ApplyPadTsSolver
  private readonly context: PadJunctionContext
  override pipelineDef: PipelineStep<BaseSolver>[] = [
    definePipelineStep(
      "findPadVsSolver",
      FindPadVsSolver,
      (p: PadJunctionSimplificationSolver) => [p.context],
    ),
    definePipelineStep(
      "constructPadTsSolver",
      ConstructPadTsSolver,
      (p: PadJunctionSimplificationSolver) => [
        { context: p.context, vs: p.findPadVsSolver.getOutput() },
      ],
    ),
    definePipelineStep(
      "applyPadTsSolver",
      ApplyPadTsSolver,
      (p: PadJunctionSimplificationSolver) => [
        { context: p.context, ts: p.constructPadTsSolver.getOutput() },
      ],
    ),
  ]
  constructor(input: PadJunctionSimplificationInput) {
    super(input)
    const nets = new Map<string, string>()
    const getNet = getPadNet.bind(null, input.connMap, nets)
    this.context = {
      ...parsePadJunctionInput(input, getNet),
      input,
      getNet,
      lockedRoutes: new Set(),
    }
    this.MAX_ITERATIONS = this.context.pads.length * 3 + 7
  }
  get outcomes(): PadJunctionOutcome[] {
    return this.applyPadTsSolver?.outcomes ?? []
  }
  get acceptedReplacement(): AcceptedReplacement | null {
    return this.applyPadTsSolver?.acceptedReplacement ?? null
  }
  override _step(): void {
    super._step()
    this.stats = {
      padsVisited: this.findPadVsSolver?.stats.padsVisited ?? 0,
      replacements: this.context.lockedRoutes.size / 2,
    }
  }
  override getConstructorParams(): [PadJunctionSimplificationInput] {
    return [this.inputProblem]
  }
  override getOutput(): HighDensityRoute[] {
    if (!this.solved)
      throw new Error(
        "PadJunctionSimplificationSolver: output requested before completion",
      )
    return this.applyPadTsSolver.getOutput()
  }
  override initialVisualize(): GraphicsObject {
    return visualizePadJunctionSimplification(
      this.inputProblem,
      this.inputProblem.hdRoutes,
      this.context.pads,
    )
  }
  override finalVisualize(): GraphicsObject {
    return visualizePadJunctionSimplification(
      this.inputProblem,
      this.context.output,
      this.context.pads,
    )
  }
  override visualize(): GraphicsObject {
    if (this.solved) return this.finalVisualize()
    if (this.activeSubSolver) return this.activeSubSolver.visualize()
    if (this.currentPipelineStageIndex === 0) return this.initialVisualize()
    // Between stages retain the preceding view, including Cartesian coordinates.
    const previousStage = this.pipelineDef[this.currentPipelineStageIndex - 1]!
    const previousSolver = this.getSolver(previousStage.solverName)
    if (!previousSolver)
      throw new Error(
        `Missing completed pad stage "${previousStage.solverName}"`,
      )
    return previousSolver.visualize()
  }
}
