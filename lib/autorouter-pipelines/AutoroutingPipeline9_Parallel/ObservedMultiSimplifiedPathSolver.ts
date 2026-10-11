import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5 } from "@tscircuit/trace-simplification-solver"
import { segmentToBoxMinDistance } from "@tscircuit/math-utils"
import type { ParallelPathQueryFootprint, ParallelPathQueryPoint } from "./parallelPathLookaheadTypes"

const nativePathPredicate = SingleSimplifiedPathSolver5.prototype.isValidPathSegment
const maximumRecordedQueries = 100_000

/** Observe the native child after construction and before its first native step. */
export class ObservedMultiSimplifiedPathSolver extends MultiSimplifiedPathSolver {
  private observedChild: SingleSimplifiedPathSolver5 | undefined
  readonly footprint: ParallelPathQueryFootprint = {
    complete: true,
    queries: [],
    nativeQueryCount: 0,
    obstacleWitnessTests: 0,
  }

  beginObservedRoute(): void {
    this.observedChild = undefined
    this.footprint.complete = true
    this.footprint.queries = []
    this.footprint.nativeQueryCount = 0
    this.footprint.obstacleWitnessTests = 0
  }

  override _step(): void {
    super._step()
    const child = this.activeSubSolver
    if (!(child instanceof SingleSimplifiedPathSolver5) || child === this.observedChild) return
    this.observedChild = child
    const footprint = this.footprint
    child.isValidPathSegment = function (start: ParallelPathQueryPoint, end: ParallelPathQueryPoint): boolean {
      // Calling the unchanged predicate once preserves the native decision and
      // short circuit order. Witness discovery is separately counted physical work.
      const valid = nativePathPredicate.call(this, start, end)
      footprint.nativeQueryCount++
      if (footprint.queries.length >= maximumRecordedQueries) {
        footprint.complete = false
        return valid
      }
      let immutableObstacleFailure = false
      if (!valid) {
        for (const obstacle of this.filteredObstacles) {
          if (!obstacle.__zLayers?.includes(start.z)) continue
          footprint.obstacleWitnessTests++
          if (segmentToBoxMinDistance(start, end, obstacle) < this.OBSTACLE_MARGIN + this.TRACE_THICKNESS / 2) {
            immutableObstacleFailure = true
            break
          }
        }
      }
      footprint.queries.push({ start: { x: start.x, y: start.y, z: start.z },
        end: { x: end.x, y: end.y, z: end.z }, valid, immutableObstacleFailure })
      return valid
    }
  }
}
