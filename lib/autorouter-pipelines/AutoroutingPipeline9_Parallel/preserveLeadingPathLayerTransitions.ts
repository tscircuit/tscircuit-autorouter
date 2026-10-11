import { MultiSimplifiedPathSolver, SingleSimplifiedPathSolver5, VertexShortcutPathSolver } from "@tscircuit/trace-simplification-solver"
import type { HighDensityRoute } from "../../types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]
type PathWorkspace = {
  pathSegments: Array<{ startDistance: number }>
  totalPathLength: number
  tailDistanceAlongPath: number
  headDistanceAlongPath: number
  lastValidPathHeadDistance: number
  getPointAtDistance(distance: number): RoutePoint
  getNearestIndexForDistance(distance: number): number
}

const preparedSolvers = new WeakSet<SingleSimplifiedPathSolver5>()
const installedSolvers = new WeakSet<MultiSimplifiedPathSolver>()

/** Keep zero-XY terminal transitions before the sampler's first interpolation. */
function prepareLeadingAnchors(solver: SingleSimplifiedPathSolver5): void {
  if (preparedSolvers.has(solver) || solver instanceof VertexShortcutPathSolver) return
  if (solver.iterations !== 0) throw new Error("Physical path anchors must be installed before sampling starts")
  preparedSolvers.add(solver)
  const points = solver.inputRoute.route
  const first = points[0]
  if (!first) return
  let end = 0
  let changesLayer = false
  while (end + 1 < points.length && points[end + 1]!.x === first.x && points[end + 1]!.y === first.y) {
    changesLayer ||= points[end]!.z !== points[end + 1]!.z
    end++
  }
  if (!changesLayer) return
  const workspace = solver as unknown as PathWorkspace
  const distance = workspace.pathSegments[end]?.startDistance ?? workspace.totalPathLength
  const enteredPoint = points[end]!
  solver.newRoute = points.slice(0, end + 1).map((point) => ({ ...point }))
  const needsVia = points.slice(0, end).some((point, index) =>
    point.z !== points[index + 1]!.z && point.toNextSegmentType !== "through_obstacle")
  if (needsVia) {
    const via = solver.inputRoute.vias.find((candidate) =>
      Math.hypot(candidate.x - first.x, candidate.y - first.y) <= 1e-6)
    if (!via) throw new Error(`Physical path sampling requires its leading via for ${solver.inputRoute.connectionName}`)
    solver.newVias.push({ ...via })
  }
  workspace.tailDistanceAlongPath = distance
  workspace.headDistanceAlongPath = distance
  workspace.lastValidPathHeadDistance = distance
  const nativePointAtDistance = workspace.getPointAtDistance.bind(solver)
  const nativeIndexAtDistance = workspace.getNearestIndexForDistance.bind(solver)
  // The first via has exactly zero sampling length. Native interpolation at
  // distance zero divides 0/0; its index lookup also selects the leaving plane.
  // Start the planar suffix at the exact entered anchor, without nudging copper.
  workspace.getPointAtDistance = (value: number): RoutePoint =>
    value === distance ? enteredPoint : nativePointAtDistance(value)
  workspace.getNearestIndexForDistance = (value: number): number =>
    value === distance ? end : nativeIndexAtDistance(value)
}

/** Opt-in hook on a fresh native multi-route phase, including worker phases. */
export function preserveLeadingPathLayerTransitions(solver: MultiSimplifiedPathSolver): void {
  if (installedSolvers.has(solver)) return
  if (solver.iterations !== 0 || solver.activeSubSolver || solver.simplifiedHdRoutes.length !== 0) {
    throw new Error("Physical path preservation must be installed before its phase starts")
  }
  installedSolvers.add(solver)
  const nativeStep = solver._step
  const prepare = (): void => {
    if (solver.activeSubSolver instanceof SingleSimplifiedPathSolver5) prepareLeadingAnchors(solver.activeSubSolver)
  }
  solver._step = (): void => {
    prepare()
    nativeStep.call(solver)
    prepare()
  }
}
