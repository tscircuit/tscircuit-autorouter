import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Obstacle } from "lib/types"
import type {
  HighDensityRoute,
  HighDensityRoutePoint as RoutePoint,
} from "lib/types/high-density-types"
import { createObjectsWithZLayers } from "lib/utils/createObjectsWithZLayers"

export type PadJunctionPoint = { x: number; y: number; z: number }
export type JunctionPath = PadJunctionPoint[]
export type TargetPad = Obstacle & { __zLayers: number[] }
export type ParsedRoute = HighDensityRoute & {
  route: RoutePoint[]
  firstPoint: RoutePoint
  lastPoint: RoutePoint
}
export type BranchAnchor = {
  routeIndex: number
  route: ParsedRoute
  points: RoutePoint[]
  anchor: RoutePoint
  terminal: RoutePoint
  anchorIndex: number
  reversed: boolean
}
export type Trunk = [JunctionPath, JunctionPath]
export type Junction = PadJunctionPoint
export type PadStem = JunctionPath
export type PadEntry = PadJunctionPoint
export type Candidate = { trunk: Trunk; junction: Junction; padStem: PadStem }
export type FixedCopper = {
  start: PadJunctionPoint
  end: PadJunctionPoint
  width: number
  routeIndex: number
  sameNet: boolean
}
export type Clearance = number
export type PathCost = { bends: number; length: number }
export type AcceptedReplacement = Candidate
export type PadJunctionOutcome = {
  outcome: "accepted" | "no_improvement" | "no_path" | "unsupported"
  reason: string
  connectionNames: string[]
}
export type PadJunctionSimplificationInput = {
  hdRoutes: ReadonlyArray<HighDensityRoute>
  otherHdRoutes?: ReadonlyArray<HighDensityRoute>
  obstacles: ReadonlyArray<Obstacle>
  connMap: ConnectivityMap
  colorMap?: Readonly<Record<string, string>>
  layerCount: number
  outline?: ReadonlyArray<{ x: number; y: number }>
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  minTraceToPadEdgeClearance?: number
  minBoardEdgeClearance?: number
}
export type ParsedInput = Omit<
  PadJunctionSimplificationInput,
  | "hdRoutes"
  | "otherHdRoutes"
  | "obstacles"
  | "minTraceToPadEdgeClearance"
  | "minBoardEdgeClearance"
  | "colorMap"
> & {
  hdRoutes: ParsedRoute[]
  otherHdRoutes: ParsedRoute[]
  obstacles: TargetPad[]
  minTraceToPadEdgeClearance: number
  minBoardEdgeClearance: number
  colorMap: Readonly<Record<string, string>>
}
export type PadJunctionBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type PadJunctionProblem = {
  localBounds: PadJunctionBounds
  targetPad: TargetPad
  branches: [BranchAnchor, BranchAnchor]
  width: number
  z: number
  originalCost: PathCost
  fixedCopper: FixedCopper[]
  foundValid: boolean
}
export const EPSILON = 1e-7

/** Indexed geometry loops have runtime bounds that TypeScript cannot prove. */
export function getItemOrThrow<T>(items: ReadonlyArray<T>, index: number): T {
  const item = items[index]
  if (item === undefined) {
    throw new Error(
      `PadJunctionSimplificationSolver: missing item at index ${index}`,
    )
  }
  return item
}

/** Parsing boundary: validate external geometry and construct nonempty routes.
 * Parsed routes carry their endpoints, so internal routing never guesses whether
 * a terminal exists. Metadata is preserved until output removes these caches.
 */
function parseRoute(route: HighDensityRoute, layerCount: number): ParsedRoute {
  const points = route.route.map((point): RoutePoint => ({ ...point }))
  const [firstPoint] = points
  const lastPoint = points.at(-1)
  const invalidPoint = points.some(
    (point) =>
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      !Number.isInteger(point.z) ||
      point.z < 0 ||
      point.z >= layerCount ||
      (point.traceThickness !== undefined &&
        (!Number.isFinite(point.traceThickness) || point.traceThickness <= 0)),
  )
  const invalidVia = route.vias.some(
    (via) => !Number.isFinite(via.x) || !Number.isFinite(via.y),
  )
  if (
    !firstPoint ||
    !lastPoint ||
    invalidPoint ||
    invalidVia ||
    !Number.isFinite(route.traceThickness) ||
    route.traceThickness <= 0 ||
    !Number.isFinite(route.viaDiameter) ||
    route.viaDiameter <= 0
  ) {
    throw new Error(
      `PadJunctionSimplificationSolver: invalid route "${route.connectionName}"`,
    )
  }
  return {
    ...route,
    route: points,
    firstPoint,
    lastPoint,
    vias: route.vias.map((via) => ({ ...via })),
  }
}

export function parsePadJunctionInput(
  input: PadJunctionSimplificationInput,
): ParsedInput {
  const clearance = input.minTraceToPadEdgeClearance ?? 0.15
  const boardClearance = input.minBoardEdgeClearance ?? 0
  if (
    !Number.isInteger(input.layerCount) ||
    input.layerCount < 1 ||
    !Number.isFinite(clearance) ||
    clearance < 0 ||
    !Number.isFinite(boardClearance) ||
    boardClearance < 0
  ) {
    throw new Error(
      "PadJunctionSimplificationSolver: invalid layers or clearance",
    )
  }
  if (input.bounds) {
    const { minX, minY, maxX, maxY } = input.bounds
    if (
      ![minX, minY, maxX, maxY].every(Number.isFinite) ||
      minX >= maxX ||
      minY >= maxY
    ) {
      throw new Error("PadJunctionSimplificationSolver: invalid board bounds")
    }
  }
  if (
    input.outline &&
    (input.outline.length < 3 ||
      input.outline.some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
      ))
  ) {
    throw new Error("PadJunctionSimplificationSolver: invalid board outline")
  }
  for (const obstacle of input.obstacles) {
    if (
      ![
        obstacle.center.x,
        obstacle.center.y,
        obstacle.width,
        obstacle.height,
      ].every(Number.isFinite) ||
      obstacle.width <= 0 ||
      obstacle.height <= 0 ||
      (obstacle.ccwRotationDegrees !== undefined &&
        !Number.isFinite(obstacle.ccwRotationDegrees)) ||
      ("shape" in obstacle &&
        obstacle.shape !== undefined &&
        typeof obstacle.shape !== "string")
    ) {
      throw new Error(
        `PadJunctionSimplificationSolver: invalid obstacle "${obstacle.obstacleId}"`,
      )
    }
    for (const layers of [obstacle.__zLayers, obstacle.zLayers]) {
      if (
        layers &&
        (layers.length === 0 ||
          layers.some(
            (z) => !Number.isInteger(z) || z < 0 || z >= input.layerCount,
          ))
      ) {
        throw new Error(
          `PadJunctionSimplificationSolver: invalid obstacle layers "${obstacle.obstacleId}"`,
        )
      }
    }
  }
  const obstacles = createObjectsWithZLayers(
    input.obstacles,
    input.layerCount,
  ).map(
    (obstacle): TargetPad => ({
      ...obstacle,
      center: { ...obstacle.center },
      connectedTo: [...obstacle.connectedTo],
    }),
  )
  return {
    ...input,
    hdRoutes: input.hdRoutes.map((route) =>
      parseRoute(route, input.layerCount),
    ),
    otherHdRoutes: (input.otherHdRoutes ?? []).map((route) =>
      parseRoute(route, input.layerCount),
    ),
    obstacles,
    minTraceToPadEdgeClearance: clearance,
    minBoardEdgeClearance: boardClearance,
    colorMap: input.colorMap ?? {},
    bounds: input.bounds ? { ...input.bounds } : undefined,
    outline: input.outline?.map((point) => ({ ...point })),
  }
}

export function getPathCost(points: ReadonlyArray<PadJunctionPoint>): PathCost {
  let length = 0
  let bends = 0
  for (let index = 1; index < points.length; index++) {
    const start = getItemOrThrow(points, index - 1)
    const end = getItemOrThrow(points, index)
    length += Math.hypot(end.x - start.x, end.y - start.y)
    if (index < 2) continue
    const previous = getItemOrThrow(points, index - 2)
    const cross =
      (start.x - previous.x) * (end.y - start.y) -
      (start.y - previous.y) * (end.x - start.x)
    const dot =
      (start.x - previous.x) * (end.x - start.x) +
      (start.y - previous.y) * (end.y - start.y)
    if (Math.abs(cross) > EPSILON || dot < 0) bends++
  }
  return { bends, length }
}

export function simplifyJunctionPath(
  points: PadJunctionPoint[],
): PadJunctionPoint[] {
  const result: PadJunctionPoint[] = []
  for (const point of points) {
    const previous = result.at(-1)
    if (
      previous &&
      Math.hypot(previous.x - point.x, previous.y - point.y) < EPSILON
    )
      continue
    result.push(point)
    while (result.length >= 3 && getPathCost(result.slice(-3)).bends === 0) {
      result.splice(result.length - 2, 1)
    }
  }
  return result
}
