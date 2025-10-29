import { SimpleRouteJson } from "lib/types"
import { BaseSolver } from "../BaseSolver"
import {
  AutoroutingPipelineSolver,
  AutoroutingPipelineSolverOptions,
} from "../AutoroutingPipelineSolver"
import { areViasPresent } from "./areViasPresent"
import { ObstacleAssignmentSolver } from "./ObstacleAssignmentSolver"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import type { GraphicsObject } from "graphics-debug"

interface LoopedReassignmentZeroViaSolverOptions
  extends AutoroutingPipelineSolverOptions {}

/**
 * The LoopedReassignmentZeroViaSolver solves the routing problem using zero
 * vias. It works by running the following loop:
 *
 * 1. Solve the problem normally (with the AutoroutingPipelineSolver, configured
 *    for via minimization)
 * 2. Examine all vias, look for nearby obstacles and assign it to the net of
 *    the via
 * 3. Solve the problem again, this time with the via assignment from step 2
 * 4. Repeat steps 2 and 3 until the problem is solved with zero vias
 */
export class LoopedReassignmentZeroViaSolver extends BaseSolver {
  MAX_ITERATIONS = 10e6
  inputSrj: SimpleRouteJson
  srjWithObstacleAssignments: SimpleRouteJson
  opts: LoopedReassignmentZeroViaSolverOptions

  /**
   * The active sub solver alternates between the AutoroutingPipelineSolver and
   * the ObstacleAssignmentSolver.
   */
  declare activeSubSolver?:
    | AutoroutingPipelineSolver
    | ObstacleAssignmentSolver
    | null
    | undefined

  constructor(
    srj: SimpleRouteJson,
    opts: LoopedReassignmentZeroViaSolverOptions,
  ) {
    super()
    this.inputSrj = srj
    // Initially, this is the same as the input SRJ, we haven't assigned
    // obstacles yet
    this.srjWithObstacleAssignments = srj
    this.opts = opts
  }

  _step() {
    if (!this.activeSubSolver) {
      this.activeSubSolver = new AutoroutingPipelineSolver(
        this.srjWithObstacleAssignments,
        this.opts,
      )
      return
    }
    this.activeSubSolver.step()

    if (
      this.activeSubSolver.constructor.name === "AutoroutingPipelineSolver" &&
      this.activeSubSolver.solved
    ) {
      const pipelineSolver = this.activeSubSolver as AutoroutingPipelineSolver
      const outputTraces = pipelineSolver.getOutputSimplifiedPcbTraces()
      if (areViasPresent(outputTraces)) {
        this.activeSubSolver = new ObstacleAssignmentSolver({
          inputSrj: this.srjWithObstacleAssignments,
          vias: outputTraces.flatMap((trace) =>
            trace.route
              .filter((segment) => segment.route_type === "via")
              .map((segment) => ({
                x: segment.x,
                y: segment.y,
                fromLayer: segment.from_layer,
                toLayer: segment.to_layer,
                trace,
              })),
          ),
          routesWithVias: outputTraces,
        })
        return
      }
      this.solved = true
    } else if (
      this.activeSubSolver.constructor.name === "ObstacleAssignmentSolver" &&
      this.activeSubSolver.solved
    ) {
      const assignmentSolver = this.activeSubSolver as ObstacleAssignmentSolver
      this.srjWithObstacleAssignments = assignmentSolver.getOutputSrj()
      console.log("srjWithObstacleAssignments", this.srjWithObstacleAssignments)
      // Start a new pipeline solver with the updated obstacle assignments
      this.activeSubSolver = new AutoroutingPipelineSolver(
        this.srjWithObstacleAssignments,
        this.opts,
      )
    } else if (this.activeSubSolver.failed) {
      this.failed = true
    }
  }

  visualize(): GraphicsObject {
    if (this.activeSubSolver) {
      return this.activeSubSolver.visualize()
    }
    return convertSrjToGraphicsObject(this.inputSrj)
  }

  getOutputSimplifiedPcbTraces() {
    if (!this.solved) {
      throw new Error("LoopedReassignmentZeroViaSolver has not been solved yet")
    }
    if (
      this.activeSubSolver &&
      this.activeSubSolver.constructor.name === "AutoroutingPipelineSolver"
    ) {
      return (
        this.activeSubSolver as AutoroutingPipelineSolver
      ).getOutputSimplifiedPcbTraces()
    }
    throw new Error("No AutoroutingPipelineSolver available for output")
  }

  getOutputSimpleRouteJson(): SimpleRouteJson {
    if (!this.solved) {
      throw new Error("LoopedReassignmentZeroViaSolver has not been solved yet")
    }
    if (
      this.activeSubSolver &&
      this.activeSubSolver.constructor.name === "AutoroutingPipelineSolver"
    ) {
      return (
        this.activeSubSolver as AutoroutingPipelineSolver
      ).getOutputSimpleRouteJson()
    }
    throw new Error("No AutoroutingPipelineSolver available for output")
  }
}
