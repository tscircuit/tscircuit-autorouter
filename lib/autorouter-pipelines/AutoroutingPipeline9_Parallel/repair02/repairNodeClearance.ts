// Pinned high-density-repair02 at 64bc8a1d5a1af753f1043092ffa9ec820ed14d4e.
// Copyright (c) tscircuit Inc. MIT license retained in ./LICENSE.
// Native repair order, geometry arithmetic, candidate budgets and stats retained.
import { mayCopperViolateObstacleClearance } from "./mayCopperViolateObstacleClearance"
import Flatbush from "flatbush"
import { DEFAULT_TRACE_THICKNESS, EPSILON } from "high-density-repair02/lib/high-density-repair-solver/shared/constants"
import type { BoundaryRect, HdRoute, Obstacle, XY } from "high-density-repair02/lib/high-density-repair-solver/shared/types"
import { findInteriorDiagonalSegmentsInBufferZone } from "high-density-repair02/lib/high-density-repair-solver/functions/findInteriorDiagonalSegmentsInBufferZone"
import { cloneRoute } from "high-density-repair02/lib/high-density-repair-solver/functions/cloneRoute"
import type { FixedCopperClearanceGuard } from "high-density-repair02/lib/high-density-repair-solver/functions/FixedCopperClearanceGuard"
import { segmentDistance } from "high-density-repair02/lib/high-density-repair-solver/functions/segmentDistance"

type CopperGeometry = {
  start: XY
  end: XY
  radius: number
}

type CopperScene = {
  index: Flatbush
  routeIndexes: Uint32Array
  copperIndexes: Uint32Array
  maxMagnitude: number
  fixedRoutes: HdRoute[]
}

/** Copper pairs grouped by the unchanged route, in original copper order. */
export type NearbyCopperPairs = Map<number, number[][]>

/** Reuse the unchanged board's broadphase throughout a candidate sweep. */
export class RouteCopperScenePatternCache {
  private scenes = new WeakMap<HdRoute[], Map<number, CopperScene>>()
  private retainedBytes = 0
  private readonly maximumBytes = 32 * 1024 * 1024

  getCandidatePairs(
    currentRoutes: HdRoute[],
    fixedRoutes: HdRoute[],
    changedRoute: number,
    geometries: CopperGeometry[][],
    clearance: number,
  ): NearbyCopperPairs | undefined {
    if (!Number.isFinite(clearance) || clearance < 0) return undefined
    const changedCopper = geometries[changedRoute]!
    for (const copper of changedCopper) {
      if (
        !Number.isFinite(copper.start.x) ||
        !Number.isFinite(copper.start.y) ||
        !Number.isFinite(copper.end.x) ||
        !Number.isFinite(copper.end.y) ||
        !Number.isFinite(copper.radius) ||
        copper.radius < 0
      )
        return undefined
    }
    let byChangedRoute = this.scenes.get(currentRoutes)
    let scene = byChangedRoute?.get(changedRoute)
    if (scene?.fixedRoutes !== fixedRoutes) scene = undefined
    if (!scene) {
      let entryCount = 0
      let maxMagnitude = 1
      for (let routeIndex = 0; routeIndex < geometries.length; routeIndex++) {
        if (routeIndex === changedRoute) continue
        for (
          let copperIndex = 0;
          copperIndex < geometries[routeIndex]!.length;
          copperIndex++
        ) {
          const copper = geometries[routeIndex]![copperIndex]!
          if (
            !Number.isFinite(copper.start.x) ||
            !Number.isFinite(copper.start.y) ||
            !Number.isFinite(copper.end.x) ||
            !Number.isFinite(copper.end.y) ||
            !Number.isFinite(copper.radius) ||
            copper.radius < 0
          )
            return undefined
          maxMagnitude = Math.max(
            maxMagnitude,
            Math.abs(copper.start.x),
            Math.abs(copper.start.y),
            Math.abs(copper.end.x),
            Math.abs(copper.end.y),
            copper.radius,
          )
          entryCount++
        }
      }
      // Small scenes cost less to scan than to index.
      if (entryCount < 32) return undefined
      const index = new Flatbush(entryCount)
      const routeIndexes = new Uint32Array(entryCount)
      const copperIndexes = new Uint32Array(entryCount)
      let entryIndex = 0
      for (let routeIndex = 0; routeIndex < geometries.length; routeIndex++) {
        if (routeIndex === changedRoute) continue
        for (
          let copperIndex = 0;
          copperIndex < geometries[routeIndex]!.length;
          copperIndex++
        ) {
          const copper = geometries[routeIndex]![copperIndex]!
          const minX = Math.min(copper.start.x, copper.end.x) - copper.radius
          const minY = Math.min(copper.start.y, copper.end.y) - copper.radius
          const maxX = Math.max(copper.start.x, copper.end.x) + copper.radius
          const maxY = Math.max(copper.start.y, copper.end.y) + copper.radius
          if (
            !Number.isFinite(minX) ||
            !Number.isFinite(minY) ||
            !Number.isFinite(maxX) ||
            !Number.isFinite(maxY)
          )
            return undefined
          index.add(minX, minY, maxX, maxY)
          routeIndexes[entryIndex] = routeIndex
          copperIndexes[entryIndex] = copperIndex
          entryIndex++
        }
      }
      index.finish()
      scene = { index, routeIndexes, copperIndexes, maxMagnitude, fixedRoutes }
      const bytes =
        index.data.byteLength +
        routeIndexes.byteLength +
        copperIndexes.byteLength
      if (this.retainedBytes + bytes > this.maximumBytes) {
        this.scenes = new WeakMap()
        this.retainedBytes = 0
        byChangedRoute = undefined
      }
      if (bytes <= this.maximumBytes) {
        if (!byChangedRoute) {
          byChangedRoute = new Map()
          this.scenes.set(currentRoutes, byChangedRoute)
        }
        byChangedRoute.set(changedRoute, scene)
        this.retainedBytes += bytes
      }
    }
    const pairs: NearbyCopperPairs = new Map()
    for (
      let changedIndex = 0;
      changedIndex < changedCopper.length;
      changedIndex++
    ) {
      const copper = changedCopper[changedIndex]!
      const reach = clearance + copper.radius
      // Broadphase arithmetic groups radii differently from the exact test.
      // Expand by several ULPs; the original AABB predicate still decides.
      const padding =
        Number.EPSILON *
        8 *
        (scene.maxMagnitude +
          Math.abs(copper.start.x) +
          Math.abs(copper.start.y) +
          Math.abs(copper.end.x) +
          Math.abs(copper.end.y) +
          reach +
          1)
      if (!Number.isFinite(padding + reach)) return undefined
      const hits = scene.index
        .search(
          Math.min(copper.start.x, copper.end.x) - reach - padding,
          Math.min(copper.start.y, copper.end.y) - reach - padding,
          Math.max(copper.start.x, copper.end.x) + reach + padding,
          Math.max(copper.start.y, copper.end.y) + reach + padding,
        )
        .sort((a, b) => a - b)
      for (const hit of hits) {
        const routeIndex = scene.routeIndexes[hit]!
        const copperIndex = scene.copperIndexes[hit]!
        let byFirstCopper = pairs.get(routeIndex)
        if (!byFirstCopper) {
          byFirstCopper = []
          pairs.set(routeIndex, byFirstCopper)
        }
        const firstIndex =
          routeIndex < changedRoute ? copperIndex : changedIndex
        const secondIndex =
          routeIndex < changedRoute ? changedIndex : copperIndex
        const secondIndexes = (byFirstCopper[firstIndex] ??= [])
        secondIndexes.push(secondIndex)
      }
    }
    return pairs
  }
}

type Copper = {
  start: XY
  end: XY
  radius: number
  minZ: number
  maxZ: number
  indexes: number[]
  via: boolean
  viaIndex?: number
}

type Conflict = {
  key: string
  firstRoute: number
  secondRoute: number
  first: Copper
  second: Copper
  penetration: number
}

type Evaluation = { conflicts: Conflict[]; score: number }

export type NodeClearanceRepairResult = {
  routes: HdRoute[]
  initialConflictCount: number
  finalConflictCount: number
  candidateCount: number
}

const collectCopper = (route: HdRoute): Copper[] => {
  const points = route.route ?? []
  const copper: Copper[] = []
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1]!
    const end = points[index]!
    if ((start.z ?? 0) !== (end.z ?? 0)) continue
    copper.push({
      start,
      end,
      radius: (route.traceThickness ?? DEFAULT_TRACE_THICKNESS) / 2,
      minZ: start.z ?? 0,
      maxZ: start.z ?? 0,
      indexes: [index - 1, index],
      via: false,
    })
  }
  for (const [viaIndex, via] of (route.vias ?? []).entries()) {
    const indexes = points.flatMap((point, index) =>
      point.x === via.x && point.y === via.y ? [index] : [],
    )
    const layers = indexes.map((index) => points[index]!.z ?? 0)
    copper.push({
      start: via,
      end: via,
      radius: (via.diameter ?? route.viaDiameter ?? 0.3) / 2,
      minZ: layers.length ? Math.min(...layers) : 0,
      maxZ: layers.length ? Math.max(...layers) : 1,
      indexes,
      via: true,
      viaIndex,
    })
  }
  return copper
}

const evaluate = (
  routes: HdRoute[],
  clearance: number,
  obstacles: Obstacle[],
  fixedRoutes: HdRoute[] = [],
  previous?: {
    evaluation: Evaluation
    changedRoute: number
    routes: HdRoute[]
  },
  geometryCache = new WeakMap<HdRoute, Copper[]>(),
  spatialPatternCache = new RouteCopperScenePatternCache(),
): Evaluation => {
  const allRoutes = [...routes, ...fixedRoutes]
  const geometries = allRoutes.map((route) => {
    let copper = geometryCache.get(route)
    if (!copper) {
      copper = collectCopper(route)
      geometryCache.set(route, copper)
    }
    return copper
  })
  const nearbyPairs = previous
    ? spatialPatternCache.getCandidatePairs(
        previous.routes,
        fixedRoutes,
        previous.changedRoute,
        geometries,
        clearance,
      )
    : undefined
  const conflicts: Conflict[] = previous
    ? previous.evaluation.conflicts.filter(
        (conflict) =>
          conflict.firstRoute !== previous.changedRoute &&
          conflict.secondRoute !== previous.changedRoute,
      )
    : []
  let score = conflicts.reduce(
    (sum, conflict) => sum + conflict.penetration ** 2,
    0,
  )
  for (let firstRoute = 0; firstRoute < routes.length; firstRoute++) {
    const a = routes[firstRoute]!
    const names = new Set(
      [a.connectionName, a.rootConnectionName].filter(Boolean),
    )
    if (!previous || firstRoute === previous.changedRoute) {
      const vias = geometries[firstRoute]!.filter((part) => part.via)
      for (let firstIndex = 0; firstIndex < vias.length; firstIndex++) {
        const first = vias[firstIndex]!
        for (
          let secondIndex = firstIndex + 1;
          secondIndex < vias.length;
          secondIndex++
        ) {
          const second = vias[secondIndex]!
          if (first.maxZ < second.minZ || second.maxZ < first.minZ) continue
          const distance = Math.hypot(
            first.start.x - second.start.x,
            first.start.y - second.start.y,
          )
          if (distance === 0) continue
          const penetration =
            clearance + first.radius + second.radius - distance
          if (penetration <= EPSILON) continue
          conflicts.push({
            key: `${firstRoute}:vias:${firstIndex}:${secondIndex}`,
            firstRoute,
            secondRoute: firstRoute,
            first,
            second,
            penetration,
          })
          score += penetration ** 2
        }
      }
      for (const [obstacleIndex, obstacle] of obstacles.entries()) {
        if (obstacle.connectedTo?.some((name) => names.has(name))) continue
        let worst: Conflict | undefined
        for (const copper of geometries[firstRoute]!) {
          if (
            obstacle.zLayers &&
            !obstacle.zLayers.some((z) => z >= copper.minZ && z <= copper.maxZ)
          )
            continue
          if (!mayCopperViolateObstacleClearance(copper, obstacle, clearance)) continue
          const penetration = clearance - distanceToObstacle(copper, obstacle)
          if (
            penetration <= EPSILON ||
            penetration <= (worst?.penetration ?? 0)
          )
            continue
          worst = {
            key: `${firstRoute}:pad:${obstacleIndex}`,
            firstRoute,
            secondRoute: -1,
            first: copper,
            second: copper,
            penetration,
          }
        }
        if (worst) {
          conflicts.push(worst)
          score += worst.penetration ** 2
        }
      }
    }
    for (
      let secondRoute = firstRoute + 1;
      secondRoute < allRoutes.length;
      secondRoute++
    ) {
      if (
        previous &&
        firstRoute !== previous.changedRoute &&
        secondRoute !== previous.changedRoute
      )
        continue
      const b = allRoutes[secondRoute]!
      const sameNet =
        names.has(b.connectionName) || names.has(b.rootConnectionName)
      // Track each via and trace layer independently. A less severe contact
      // must not hide a new violation at another via or on another layer.
      // Trace segments still share a key so splitting one does not change
      // the objective merely by changing its number of pieces.
      const worstByType = new Map<string, Conflict>()
      const nearbySecondIndexes = nearbyPairs?.get(
        firstRoute === previous?.changedRoute ? secondRoute : firstRoute,
      )
      if (nearbyPairs && !nearbySecondIndexes) continue
      const firstGeometry = geometries[firstRoute]!
      const secondGeometry = geometries[secondRoute]!
      for (
        let firstIndex = 0;
        firstIndex < firstGeometry.length;
        firstIndex++
      ) {
        const first = firstGeometry[firstIndex]!
        const secondIndexes = nearbySecondIndexes?.[firstIndex]
        if (nearbyPairs && !secondIndexes) continue
        const secondCount = secondIndexes
          ? secondIndexes.length
          : secondGeometry.length
        for (
          let candidateIndex = 0;
          candidateIndex < secondCount;
          candidateIndex++
        ) {
          const second =
            secondGeometry[
              secondIndexes ? secondIndexes[candidateIndex]! : candidateIndex
            ]!
          if (sameNet && !(first.via && second.via)) continue
          if (first.maxZ < second.minZ || second.maxZ < first.minZ) continue
          if (
            sameNet &&
            first.start.x === second.start.x &&
            first.start.y === second.start.y
          )
            continue
          const required = clearance + first.radius + second.radius
          if (
            Math.min(first.start.x, first.end.x) >
              Math.max(second.start.x, second.end.x) + required ||
            Math.min(second.start.x, second.end.x) >
              Math.max(first.start.x, first.end.x) + required ||
            Math.min(first.start.y, first.end.y) >
              Math.max(second.start.y, second.end.y) + required ||
            Math.min(second.start.y, second.end.y) >
              Math.max(first.start.y, first.end.y) + required
          )
            continue
          const penetration =
            required -
            segmentDistance(first.start, first.end, second.start, second.end)
          if (penetration <= EPSILON) continue
          const firstKey = first.via
            ? `via:${first.viaIndex}`
            : `trace:${first.minZ}`
          const secondKey = second.via
            ? `via:${second.viaIndex}`
            : `trace:${second.minZ}`
          const key = `${firstKey}:${secondKey}`
          if (penetration <= (worstByType.get(key)?.penetration ?? 0)) continue
          worstByType.set(key, {
            key: `${firstRoute}:${secondRoute}:${key}`,
            firstRoute,
            secondRoute,
            first,
            second,
            penetration,
          })
        }
      }
      for (const conflict of worstByType.values()) {
        conflicts.push(conflict)
        score += conflict.penetration ** 2
      }
    }
  }
  conflicts.sort((a, b) => b.penetration - a.penetration)
  return { conflicts, score }
}

export const hasNodeClearanceRegression = (
  before: HdRoute[],
  after: HdRoute[],
  clearance: number,
): boolean => {
  const previous = new Map(
    evaluate(before, clearance, []).conflicts.map((conflict) => [
      conflict.key,
      conflict.penetration,
    ]),
  )
  return evaluate(after, clearance, []).conflicts.some(
    (conflict) =>
      conflict.penetration > (previous.get(conflict.key) ?? 0) + EPSILON,
  )
}

const distanceToObstacle = (copper: Copper, obstacle: Obstacle): number => {
  if (
    !obstacle.center ||
    obstacle.width === undefined ||
    obstacle.height === undefined
  )
    return Infinity
  const left = obstacle.center.x - obstacle.width / 2
  const right = obstacle.center.x + obstacle.width / 2
  const bottom = obstacle.center.y - obstacle.height / 2
  const top = obstacle.center.y + obstacle.height / 2
  let interiorPenetration = 0
  for (const point of [copper.start, copper.end]) {
    if (
      point.x >= left &&
      point.x <= right &&
      point.y >= bottom &&
      point.y <= top
    ) {
      interiorPenetration = Math.max(
        interiorPenetration,
        copper.radius +
          Math.min(
            point.x - left,
            right - point.x,
            point.y - bottom,
            top - point.y,
          ),
      )
    }
  }
  if (interiorPenetration > 0) return -interiorPenetration
  const corners = [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: right, y: top },
    { x: left, y: top },
  ]
  return (
    Math.min(
      ...corners.map((point, index) =>
        segmentDistance(
          copper.start,
          copper.end,
          point,
          corners[(index + 1) % 4]!,
        ),
      ),
    ) - copper.radius
  )
}

export const getRouteObstacleClearance = (
  route: HdRoute,
  obstacle: Obstacle,
): number => {
  const relevantCopper = collectCopper(route).filter(
    (part) =>
      !obstacle.zLayers ||
      obstacle.zLayers.some((z) => z >= part.minZ && z <= part.maxZ),
  )
  return Math.min(
    ...relevantCopper.map((part) => distanceToObstacle(part, obstacle)),
  )
}

const moveCopper = (
  route: HdRoute,
  copper: Copper,
  dx: number,
  dy: number,
  boundary: BoundaryRect,
): HdRoute | undefined => {
  const candidate = cloneRoute(route)
  const points = candidate.route ?? []
  const originalPoints = route.route ?? []
  const fixed = (index: number) => index === 0 || index === points.length - 1
  const moving = new Set<number>()
  // Preserve node ports while moving the free end of a port-adjacent segment.
  // Moving only a new dogleg leaves the original interior corner in collision.
  for (const index of copper.indexes) {
    if (fixed(index)) continue
    const anchor = originalPoints[index]!
    originalPoints.forEach((point, otherIndex) => {
      if (point.x === anchor.x && point.y === anchor.y) moving.add(otherIndex)
    })
  }
  if ([...moving].some(fixed)) return undefined
  if (copper.via && copper.indexes.some(fixed)) return undefined
  if (moving.size === 0) {
    if (copper.via || copper.indexes.length !== 2) return undefined
    // A segment between two fixed ports needs a bend instead.
    const [startIndex, endIndex] = copper.indexes as [number, number]
    const start = points[startIndex]!
    const end = points[endIndex]!
    const additions = [0.25, 0.75].map((t) => ({
      ...start,
      x: start.x + (end.x - start.x) * t + dx,
      y: start.y + (end.y - start.y) * t + dy,
    }))
    points.splice(endIndex, 0, ...additions)
  } else {
    for (const index of moving) {
      points[index]!.x += dx
      points[index]!.y += dy
    }
    for (const via of candidate.vias ?? []) {
      if (
        [...moving].some(
          (index) =>
            originalPoints[index]!.x === via.x &&
            originalPoints[index]!.y === via.y,
        )
      ) {
        via.x += dx
        via.y += dy
      }
    }
  }
  if (
    points.some(
      (point, index) =>
        index > 0 &&
        index < points.length - 1 &&
        (point.x < boundary.minX ||
          point.x > boundary.maxX ||
          point.y < boundary.minY ||
          point.y > boundary.maxY),
    )
  )
    return undefined
  return candidate
}

/** Repair native node copper directly; never crop, stitch, or reconstruct a board. */
export const repairNodeClearance = ({
  routes,
  fixedRoutes = [],
  boundary,
  fixedCopperGuard,
  adjacentObstacles = [],
  clearanceObstacles = adjacentObstacles,
  clearance = 0.1,
  boundaryMargin = 0.2,
  maxCandidates,
}: {
  routes: HdRoute[]
  fixedRoutes?: HdRoute[]
  boundary: BoundaryRect
  fixedCopperGuard: FixedCopperClearanceGuard
  adjacentObstacles?: Obstacle[]
  clearanceObstacles?: Obstacle[]
  clearance?: number
  boundaryMargin?: number
  maxCandidates?: number
}): NodeClearanceRepairResult => {
  let current = routes
  const geometryCache = new WeakMap<HdRoute, Copper[]>()
  const spatialPatternCache = new RouteCopperScenePatternCache()
  let evaluation = evaluate(
    current,
    clearance,
    clearanceObstacles,
    fixedRoutes,
    undefined,
    geometryCache,
    spatialPatternCache,
  )
  // Give each initial conflict a full sweep of both copper parts, three
  // distances and eight directions, with room for a second improving move.
  const candidateLimit =
    maxCandidates ?? Math.max(256, evaluation.conflicts.length * 96)
  const result: NodeClearanceRepairResult = {
    routes,
    initialConflictCount: evaluation.conflicts.length,
    finalConflictCount: evaluation.conflicts.length,
    candidateCount: 0,
  }
  while (
    evaluation.conflicts.length &&
    result.candidateCount < candidateLimit
  ) {
    let improved = false
    const currentPenetrations = new Map(
      evaluation.conflicts.map((conflict) => [
        conflict.key,
        conflict.penetration,
      ]),
    )
    for (const conflict of evaluation.conflicts) {
      for (const [routeIndex, copper] of [
        [conflict.firstRoute, conflict.first],
        [conflict.secondRoute, conflict.second],
      ] as const) {
        if (routeIndex < 0 || routeIndex >= current.length) continue
        const before = current[routeIndex]!
        const names = new Set(
          [before.connectionName, before.rootConnectionName].filter(Boolean),
        )
        const foreignObstacles = clearanceObstacles.filter(
          (obstacle) => !obstacle.connectedTo?.some((name) => names.has(name)),
        )
        const beforeCopper = collectCopper(before)
        const boundaryViolations = findInteriorDiagonalSegmentsInBufferZone(
          [before],
          boundary,
          boundaryMargin,
        ).length
        const obstacleClearances = foreignObstacles.map((obstacle) =>
          Math.min(
            ...beforeCopper
              .filter(
                (part) =>
                  !obstacle.zLayers ||
                  obstacle.zLayers.some(
                    (z) => z >= part.minZ && z <= part.maxZ,
                  ),
              )
              .map((part) => distanceToObstacle(part, obstacle)),
          ),
        )
        for (const scale of [1.01, 2, 4]) {
          const amount = Math.max(0.01, conflict.penetration * scale)
          for (const [x, y] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
            [Math.SQRT1_2, Math.SQRT1_2],
            [-Math.SQRT1_2, Math.SQRT1_2],
            [Math.SQRT1_2, -Math.SQRT1_2],
            [-Math.SQRT1_2, -Math.SQRT1_2],
          ]) {
            if (result.candidateCount >= candidateLimit) break
            result.candidateCount++
            const moved = moveCopper(
              before,
              copper,
              x! * amount,
              y! * amount,
              boundary,
            )
            if (!moved) continue
            if (
              findInteriorDiagonalSegmentsInBufferZone(
                [moved],
                boundary,
                boundaryMargin,
              ).length > boundaryViolations
            )
              continue
            const candidate = [...current]
            candidate[routeIndex] = moved
            const next = evaluate(
              candidate,
              clearance,
              clearanceObstacles,
              fixedRoutes,
              { evaluation, changedRoute: routeIndex, routes: current },
              geometryCache,
              spatialPatternCache,
            )
            if (
              next.conflicts.length > evaluation.conflicts.length ||
              next.score >= evaluation.score - EPSILON ** 2
            )
              continue
            if (
              next.conflicts.some(
                (contact) =>
                  contact.penetration >
                  (currentPenetrations.get(contact.key) ?? 0) + EPSILON,
              )
            )
              continue
            if (
              !fixedCopperGuard.allows(current, candidate, [routeIndex], false)
            )
              continue
            const afterCopper = collectCopper(moved)
            if (
              foreignObstacles.some(
                (obstacle, index) =>
                  Math.min(
                    ...afterCopper
                      .filter(
                        (part) =>
                          !obstacle.zLayers ||
                          obstacle.zLayers.some(
                            (z) => z >= part.minZ && z <= part.maxZ,
                          ),
                      )
                      .map((part) => distanceToObstacle(part, obstacle)),
                  ) <
                  Math.min(clearance, obstacleClearances[index]!) - EPSILON,
              )
            )
              continue
            current = candidate
            evaluation = next
            improved = true
            break
          }
          if (improved || result.candidateCount >= candidateLimit) break
        }
        if (improved || result.candidateCount >= candidateLimit) break
      }
      if (improved || result.candidateCount >= candidateLimit) break
    }
    if (!improved) break
  }
  return {
    ...result,
    routes: current,
    finalConflictCount: evaluation.conflicts.length,
  }
}
