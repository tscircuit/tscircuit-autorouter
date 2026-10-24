import { getRepairCopperLayerSpan } from "./getRepairCopperLayerSpan"
import { pointToSegmentClosestPoint } from "@tscircuit/math-utils"
import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "./repairTypes"
import {
  getLocalObstacleGeometry,
  getLocalObstacleDistance,
  type ObstacleDistanceGeometry,
} from "./obstacleDistanceGeometry"
import type { RepairRoutePoint } from "./repairRegionTypes"

export type FixedObstacleViolation = {
  /** Geometry-independent identity, stable when points are inserted or moved. */
  key: string
  center: { x: number; y: number }
  routeIndex: number
  obstacleIndex: number
  kind: "wire" | "via"
  /** Required edge clearance minus measured clearance, in millimeters. */
  severity: number
}

export type FixedObstacleViolationInput = {
  srj: SimpleRouteJson
  routes: HighDensityRoute[]
  traceClearance?: number
  viaClearance?: number
}

type Obstacle = SimpleRouteJson["obstacles"][number]
type Point = { x: number; y: number }

export const getNetRepresentatives = (
  srj: Pick<SimpleRouteJson, "connections" | "obstacles">,
  routes: readonly HighDensityRoute[],
): Map<string, string> => {
  const parents = new Map<string, string>()
  const find = (name: string): string => {
    const parent = parents.get(name)
    if (parent === undefined) {
      parents.set(name, name)
      return name
    }
    if (parent === name) return name
    const root = find(parent)
    parents.set(name, root)
    return root
  }
  const union = (names: Array<string | undefined>): void => {
    const present = names.filter(
      (name): name is string => typeof name === "string" && name.length > 0,
    )
    if (present.length === 0) return
    const root = find(present[0]!)
    for (const name of present) parents.set(find(name), root)
  }
  for (const original of srj.connections) {
    const connection = original as typeof original & {
      __rootConnectionNames?: string[]
      __netConnectionName?: string
    }
    union([
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...(connection.mergedConnectionNames ?? []),
      ...(connection.__rootConnectionNames ?? []),
      ...connection.pointsToConnect.flatMap((point) => [
        point.pointId,
        point.pcb_port_id,
      ]),
    ])
  }
  for (const obstacle of srj.obstacles) union(obstacle.connectedTo)
  for (const route of routes)
    union([route.connectionName, route.rootConnectionName])
  for (const name of parents.keys()) parents.set(name, find(name))
  return parents
}

const getObstacleZLayers = (
  obstacle: Obstacle,
  layerCount: number,
): Set<number> => {
  const canonical = (obstacle as Obstacle & { __zLayers?: number[] }).__zLayers
  if (canonical) return new Set(canonical)
  if (obstacle.zLayers) return new Set(obstacle.zLayers)
  const layers = new Set<number>()
  for (const layer of obstacle.layers) {
    const z =
      layer === "top"
        ? 0
        : layer === "bottom"
          ? layerCount - 1
          : /^inner\d+$/.test(layer)
            ? Number(layer.slice(5))
            : -1
    if (z < 0 || z >= layerCount)
      throw new Error(`repair04 obstacle has an unknown layer: ${layer}`)
    layers.add(z)
  }
  return layers
}

type PreparedObstacle = {
  obstacleIndex: number
  obstacle: Obstacle
  zLayers: Set<number>
  obstacleNets: Set<string>
  shape: ObstacleDistanceGeometry
  toLocal: (point: Point) => Point
  separated: (start: Point, end: Point, copperReach: number) => boolean
  wireGap: number
  viaGap: number
}

const createEvaluator = ({
  srj,
  routes: ownershipRoutes,
  traceClearance = 0.1,
  viaClearance = 0.1,
}: FixedObstacleViolationInput): ((
  routes: HighDensityRoute[],
) => FixedObstacleViolation[]) => {
  let nets: Map<string, string> | undefined
  const preparedByIndex = new Map<number, PreparedObstacle | null>()
  const relevantObstacles: PreparedObstacle[] = []
  let preparationComplete = false
  function* prepareObstacles(
    nets: Map<string, string>,
  ): Generator<PreparedObstacle> {
    for (
      let obstacleIndex = 0;
      obstacleIndex < srj.obstacles.length;
      obstacleIndex++
    ) {
      if (preparedByIndex.has(obstacleIndex)) {
        const prepared = preparedByIndex.get(obstacleIndex)
        if (prepared) yield prepared
        continue
      }
      const obstacle = srj.obstacles[obstacleIndex]!
      const recognizedPad = obstacle.connectedTo.some((id) =>
        /^(pcb_smtpad_|pcb_plated_hole_|pcb_port_)/.test(id),
      )
      const rotated = Math.abs((obstacle.ccwRotationDegrees ?? 0) % 180) > 1e-8
      const rectangularPlatedHole =
        obstacle.type === "rect" &&
        obstacle.layers.length > 1 &&
        Math.abs(obstacle.width - obstacle.height) < 0.001
      if (recognizedPad && !rotated && !rectangularPlatedHole) {
        preparedByIndex.set(obstacleIndex, null)
        continue
      }
      if (
        ![
          obstacle.center.x,
          obstacle.center.y,
          obstacle.width,
          obstacle.height,
          obstacle.ccwRotationDegrees ?? 0,
        ].every(Number.isFinite) ||
        obstacle.width < 0 ||
        obstacle.height < 0
      ) {
        throw new Error(
          "repair04 fixed obstacle geometry must be finite and nonnegative",
        )
      }
      const zLayers = getObstacleZLayers(obstacle, srj.layerCount)
      const obstacleNets = new Set(
        obstacle.connectedTo.map((name) => nets.get(name) ?? name),
      )
      const shape = getLocalObstacleGeometry(obstacle)
      const radians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
      const cosine = Math.cos(radians)
      const sine = Math.sin(radians)
      const extent = Math.hypot(obstacle.width, obstacle.height) / 2
      const toLocal = (point: Point): Point => {
        const dx = point.x - obstacle.center.x
        const dy = point.y - obstacle.center.y
        return { x: dx * cosine + dy * sine, y: -dx * sine + dy * cosine }
      }
      const separated = (
        start: Point,
        end: Point,
        copperReach: number,
      ): boolean =>
        Math.max(start.x, end.x) + copperReach < obstacle.center.x - extent ||
        Math.min(start.x, end.x) - copperReach > obstacle.center.x + extent ||
        Math.max(start.y, end.y) + copperReach < obstacle.center.y - extent ||
        Math.min(start.y, end.y) - copperReach > obstacle.center.y + extent
      const isBoardEdge =
        obstacle.obstacleId?.startsWith("repair04_board_edge_") === true
      const wireGap = isBoardEdge
        ? 0
        : obstacle.isNonPlatedHole &&
            srj.minTraceToHoleEdgeClearance !== undefined
          ? srj.minTraceToHoleEdgeClearance
          : Math.max(
              traceClearance,
              srj.defaultObstacleMargin ?? 0,
              srj.minTraceToPadEdgeClearance ?? 0,
            )
      const viaGap = isBoardEdge
        ? 0
        : Math.max(
            viaClearance,
            srj.defaultObstacleMargin ?? 0,
            srj.minViaEdgeToPadEdgeClearance ?? 0,
          )
      const prepared = {
        obstacleIndex,
        obstacle,
        zLayers,
        obstacleNets,
        shape,
        toLocal,
        separated,
        wireGap,
        viaGap,
      }
      preparedByIndex.set(obstacleIndex, prepared)
      relevantObstacles.push(prepared)
      yield prepared
    }
    preparationComplete = true
  }
  return (routes): FixedObstacleViolation[] => {
    // First use keeps the original union/validation order. Later evaluations
    // reuse only static context; candidate copper is always checked afresh.
    const currentNets = (nets ??= getNetRepresentatives(srj, ownershipRoutes))
    const violations = new Map<string, FixedObstacleViolation>()
    const obstacles = preparationComplete
      ? relevantObstacles
      : prepareObstacles(currentNets)
    for (const {
      obstacleIndex,
      obstacle,
      zLayers,
      obstacleNets,
      shape,
      toLocal,
      separated,
      wireGap,
      viaGap,
    } of obstacles) {
      for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
        const route = routes[routeIndex]!
        if (route.route.length < 2) continue
        if (
          [route.connectionName, route.rootConnectionName].some(
            (name) =>
              name !== undefined &&
              obstacleNets.has(currentNets.get(name) ?? name),
          )
        )
          continue
        for (
          let pointIndex = 1;
          pointIndex < route.route.length;
          pointIndex += 1
        ) {
          const start = route.route[pointIndex - 1]! as RepairRoutePoint
          const end = route.route[pointIndex]! as RepairRoutePoint
          if (start.toNextSegmentType === "through_obstacle") continue
          if (start.z !== end.z) {
            const span = getRepairCopperLayerSpan(srj, start, end)
            if (
              !Array.from(zLayers).some((z) => z >= span.minZ && z <= span.maxZ)
            )
              continue
            if (
              Math.abs(start.x - end.x) > 1e-8 ||
              Math.abs(start.y - end.y) > 1e-8
            )
              throw new Error("repair04 found a non-colocated via transition")
            // Validate the transition above before rejecting distant geometry.
            if (separated(start, start, route.viaDiameter / 2 + viaGap + 1e-8))
              continue
            const localStart = toLocal(start)
            const distance = getLocalObstacleDistance(
              localStart,
              localStart,
              shape,
            )
            const severity = route.viaDiameter / 2 + viaGap - distance
            if (severity <= 1e-8) continue
            const key = `fixed-obstacle:${routeIndex}:${obstacleIndex}:via`
            if ((violations.get(key)?.severity ?? -Infinity) < severity)
              violations.set(key, {
                key,
                center: { x: start.x, y: start.y },
                routeIndex,
                obstacleIndex,
                kind: "via",
                severity,
              })
            continue
          }
          if (!zLayers.has(start.z)) continue
          const radius =
            Math.max(
              start.traceThickness ?? route.traceThickness,
              end.traceThickness ?? route.traceThickness,
            ) / 2
          // A circumscribed rectangle bound can only reject strict separation;
          // near-boundary copper still receives the original exact calculation.
          if (separated(start, end, radius + wireGap + 1e-8)) continue
          const distance = getLocalObstacleDistance(
            toLocal(start),
            toLocal(end),
            shape,
          )
          const severity = radius + wireGap - distance
          if (severity <= 1e-8) continue
          const key = `fixed-obstacle:${routeIndex}:${obstacleIndex}:wire`
          if ((violations.get(key)?.severity ?? -Infinity) < severity)
            violations.set(key, {
              key,
              center: pointToSegmentClosestPoint(obstacle.center, start, end),
              routeIndex,
              obstacleIndex,
              kind: "wire",
              severity,
            })
        }
      }
    }
    return Array.from(violations.values())
  }
}

/**
 * Snapshot a solver's immutable obstacle and ownership context. Every route
 * keeps its original index and ownership aliases across subsequent calls.
 * Validation remains lazy and follows the public checker's obstacle order.
 */
export const createFixedObstacleViolationEvaluator = (
  input: FixedObstacleViolationInput,
): ((routes: HighDensityRoute[]) => FixedObstacleViolation[]) =>
  createEvaluator({
    ...input,
    srj: structuredClone(input.srj),
    routes: input.routes.map(
      (route): HighDensityRoute => ({ ...route, route: [] }),
    ),
  })

/**
 * Supplement repair03's pad DRC with generic keepouts and exact rotated
 * rectangles. Axis-aligned recognized pads remain with the existing engine,
 * except near-square multilayer rectangles whose corners its circular model omits.
 * Each public call observes its current input and uses no cross-call cache.
 */
export const getFixedObstacleViolations = (
  input: FixedObstacleViolationInput,
): FixedObstacleViolation[] => createEvaluator(input)(input.routes)
