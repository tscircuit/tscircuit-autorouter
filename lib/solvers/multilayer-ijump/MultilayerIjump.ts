/**
 * Multilayer IJump neighbor expansion and wild trace jump prevention.
 *
 * Ports the `MultilayerIjump` neighbor candidate computation from `tscircuit/autorouting`
 * with the `isGoalInTravelDir && goalDistAlongTravelDir > 0` open-corridor guard
 * and current-node `obstacleHit` forward-direction filtering (#743 / autorouting#92).
 */

export interface Point3d {
  x: number
  y: number
  l: number
}

export interface Direction3d {
  dx: number
  dy: number
  dl: number
}

export interface ObstacleBox3d {
  minX: number
  minY: number
  maxX: number
  maxY: number
  l?: number
}

export interface Node3d extends Point3d {
  parent?: Node3d | null
  obstacleHit?: ObstacleBox3d | null
}

export interface DirectionWithCollisionInfo3d extends Direction3d {
  wallDistance: number
  obstacleHit: ObstacleBox3d | null
}

export interface TravelCandidate3d extends DirectionWithCollisionInfo3d {
  travelDistance: number
  enterMarginCost: number
  travelMarginCostFactor: number
}

export interface MarginWithCost {
  margin: number
  enterCost: number
  travelCostFactor: number
}

export interface Point3dWithObstacleHit extends Point3d {
  obstacleHit: ObstacleBox3d | null
  travelDistance: number
  enterMarginCost: number
  travelMarginCostFactor: number
}

export interface MultilayerIjumpParams {
  obstacleMargin: number
  viaDiameter: number
  defaultGoalViaMargin: number
  gridStep: number
  largestMargin: number
  marginsWithCosts: Array<MarginWithCost>
}

export interface NeighborExpansionInput {
  node: Node3d
  goalPoint: Point3d
  forwardDir: Direction3d
  collisionDirs: Array<DirectionWithCollisionInfo3d>
  overcomeDistanceByDir: Map<DirectionWithCollisionInfo3d, number | null>
  params: MultilayerIjumpParams
}

/**
 * Compute the Manhattan distance between two 3D points ignoring layer index.
 */
export function manDist(a: Point3d, b: Point3d): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y)
}

/**
 * Compute the signed projection distance from `node` to `goal` along `dir`.
 */
export function distAlongDir(
  node: Point3d,
  goal: Point3d,
  dir: Direction3d,
): number {
  return (goal.x - node.x) * dir.dx + (goal.y - node.y) * dir.dy
}

/**
 * Check whether a single coordinate axis aligns with the travel direction component.
 */
function axisAlignedWithGoal(delta: number, step: number): boolean {
  if (step === 0) {
    return true
  }
  return Math.sign(delta) === step
}

/**
 * Determine whether the goal coordinate lies strictly ahead along `travelDir`.
 */
export function isGoalAheadInDirection(
  node: Point3d,
  goalPoint: Point3d,
  travelDir: Direction3d,
): boolean {
  if (!axisAlignedWithGoal(goalPoint.x - node.x, travelDir.dx)) {
    return false
  }
  return axisAlignedWithGoal(goalPoint.y - node.y, travelDir.dy)
}

/**
 * Format a direction vector into a canonical comparison key.
 */
function directionKey(dir: Direction3d): string {
  return `${dir.dx},${dir.dy},${dir.dl}`
}

/**
 * Filter candidate orthogonal directions, excluding the reverse parent direction
 * and excluding the forward direction only when the current node hit an obstacle.
 */
export function filterValidOrthoDirections(
  dirs: Array<Direction3d>,
  forwardDir: Direction3d,
  node: Node3d,
): Array<Direction3d> {
  const reverseKey = directionKey({
    dx: -forwardDir.dx,
    dy: -forwardDir.dy,
    dl: -forwardDir.dl,
  })
  const forwardKey = directionKey(forwardDir)
  return dirs.filter((dir) => {
    const key = directionKey(dir)
    if (key === reverseKey) {
      return false
    }
    if (key === forwardKey) {
      return !node.obstacleHit
    }
    return true
  })
}

/**
 * Append margin-stepped candidates for overcoming an obstacle.
 */
function appendMarginCandidates(
  out: Array<TravelCandidate3d>,
  travelDir: DirectionWithCollisionInfo3d,
  baseDistance: number,
  marginsWithCosts: Array<MarginWithCost>,
): void {
  for (const { margin, enterCost, travelCostFactor } of marginsWithCosts) {
    if (baseDistance + margin * 2 < travelDir.wallDistance) {
      out.push({
        ...travelDir,
        travelDistance: baseDistance + margin,
        enterMarginCost: enterCost,
        travelMarginCostFactor: travelCostFactor,
      })
    }
  }
}

/**
 * Append distant-wall margin stop candidates when a finite wall lies beyond `largestMargin`.
 */
function appendWallStopCandidates(
  out: Array<TravelCandidate3d>,
  travelDir: DirectionWithCollisionInfo3d,
  params: MultilayerIjumpParams,
): void {
  if (travelDir.wallDistance <= params.largestMargin) {
    return
  }
  for (const {
    margin,
    enterCost,
    travelCostFactor,
  } of params.marginsWithCosts) {
    out.push({
      ...travelDir,
      travelDistance: travelDir.wallDistance - margin,
      enterMarginCost: enterCost,
      travelMarginCostFactor: travelCostFactor,
    })
  }
}

/**
 * Append the open-corridor goal jump only when the goal lies ahead (`goalDist > 0`).
 */
function appendOpenSpaceGoalCandidate(
  out: Array<TravelCandidate3d>,
  travelDir: DirectionWithCollisionInfo3d,
  isGoalInTravelDir: boolean,
  goalDistAlongTravelDir: number,
): void {
  if (!isGoalInTravelDir) {
    return
  }
  if (goalDistAlongTravelDir <= 0) {
    return
  }
  out.push({
    ...travelDir,
    travelDistance: goalDistAlongTravelDir,
    enterMarginCost: 0,
    travelMarginCostFactor: 1,
  })
}

/**
 * Compute travel candidates when overcoming an obstacle hit on the current node.
 */
function expandOvercomeBranch(
  input: NeighborExpansionInput,
  travelDir: DirectionWithCollisionInfo3d,
  overcomeDistance: number,
): Array<TravelCandidate3d> {
  const { node, goalPoint, params } = input
  const candidates: Array<TravelCandidate3d> = []
  appendMarginCandidates(
    candidates,
    travelDir,
    overcomeDistance - params.obstacleMargin,
    params.marginsWithCosts,
  )
  if (travelDir.wallDistance === Infinity) {
    const goalDist = distAlongDir(node, goalPoint, travelDir)
    const goalAhead = isGoalAheadInDirection(node, goalPoint, travelDir)
    appendOpenSpaceGoalCandidate(candidates, travelDir, goalAhead, goalDist)
    return candidates
  }
  appendWallStopCandidates(candidates, travelDir, params)
  return candidates
}

/**
 * Check whether the goal can be reached directly before hitting a wall along `travelDir`.
 */
function canReachGoalDirectly(
  node: Point3d,
  goalPoint: Point3d,
  travelDir: DirectionWithCollisionInfo3d,
  goalDist: number,
): boolean {
  if (!isGoalAheadInDirection(node, goalPoint, travelDir)) {
    return false
  }
  if (goalDist <= 0) {
    return false
  }
  return goalDist < travelDir.wallDistance
}

/**
 * Compute travel candidates for a single orthogonal direction.
 */
function expandSingleTravelDir(
  input: NeighborExpansionInput,
  travelDir: DirectionWithCollisionInfo3d,
): Array<TravelCandidate3d> {
  const { node, goalPoint, overcomeDistanceByDir, params } = input
  const goalDist = distAlongDir(node, goalPoint, travelDir)
  if (canReachGoalDirectly(node, goalPoint, travelDir, goalDist)) {
    return [
      {
        ...travelDir,
        travelDistance: goalDist,
        enterMarginCost: 0,
        travelMarginCostFactor: 1,
      },
    ]
  }
  const overcomeDistance = overcomeDistanceByDir.get(travelDir)
  if (typeof overcomeDistance === "number") {
    return expandOvercomeBranch(input, travelDir, overcomeDistance)
  }
  const fallback: Array<TravelCandidate3d> = []
  appendWallStopCandidates(fallback, travelDir, params)
  return fallback
}

/**
 * Convert a travel candidate into a 3D neighbor point with updated obstacle state.
 */
function toNeighborPoint(
  node: Node3d,
  candidate: TravelCandidate3d,
  largestMargin: number,
): Point3dWithObstacleHit {
  const hitWall =
    candidate.travelDistance >= candidate.wallDistance - largestMargin
  const inheritedObstacle = node.obstacleHit ? node.obstacleHit : null
  return {
    x: node.x + candidate.dx * candidate.travelDistance,
    y: node.y + candidate.dy * candidate.travelDistance,
    l: node.l + candidate.dl,
    obstacleHit: hitWall ? candidate.obstacleHit : inheritedObstacle,
    travelDistance: candidate.travelDistance,
    enterMarginCost: candidate.enterMarginCost,
    travelMarginCostFactor: candidate.travelMarginCostFactor,
  }
}

/**
 * Expand all valid orthogonal directions into concrete 3D neighbor coordinates.
 */
export function expandMultilayerIjumpNeighbors(
  input: NeighborExpansionInput,
): Array<Point3dWithObstacleHit> {
  const { node, collisionDirs, params } = input
  const neighbors: Array<Point3dWithObstacleHit> = []

  for (const dir of collisionDirs) {
    if (dir.wallDistance < params.obstacleMargin) {
      continue
    }
    const travelCandidates = expandSingleTravelDir(input, dir)
    for (const candidate of travelCandidates) {
      neighbors.push(toNeighborPoint(node, candidate, params.largestMargin))
    }
  }

  return neighbors
}
