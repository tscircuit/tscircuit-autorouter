import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost } from "./SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { ReverseCostToGoCache, type ReversePotentialGeometry } from "./ReverseCostToGoCache"

type Native = SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost
type Rectangle = { minX: number; maxX: number; minY: number; maxY: number }
type Point = { x: number; y: number }

const rectangleDistance = (rectangle: Rectangle, point: Point, maximum: boolean): number => {
  const dx = maximum
    ? Math.max(Math.abs(point.x - rectangle.minX), Math.abs(point.x - rectangle.maxX))
    : Math.max(rectangle.minX - point.x, 0, point.x - rectangle.maxX)
  const dy = maximum
    ? Math.max(Math.abs(point.y - rectangle.minY), Math.abs(point.y - rectangle.maxY))
    : Math.max(rectangle.minY - point.y, 0, point.y - rectangle.maxY)
  return Math.hypot(dx, dy)
}

/**
 * A permissive quotient of native transitions, not native search-label reuse.
 * Self-via history and owner costs are deliberately relaxed.
 * Every retained edge charges no more than its corresponding real transition.
 */
export const prepareNativeReversePotential = (native: Native, cache: ReverseCostToGoCache, chargeWork?: (workUnits: number) => boolean | void): number | null => {
  const { bounds, cellStep, B, availableZ } = native
  const numericValues = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY,
    cellStep, B.x, B.y, B.z, native.viaDiameter, native.traceThickness,
    native.obstacleMargin, native.straightLineDistance, native.viaPenaltyDistance,
    native.FUTURE_CONNECTION_PROXIMITY_VD, native.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR,
    native.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR, native.MISALIGNED_DIST_PENALTY_FACTOR]
  if (numericValues.some((value) => !Number.isFinite(value)))
    throw new Error("Nonfinite native reverse potential context")
  const epsilon = Math.max(1, ...numericValues.map(Math.abs)) * Number.EPSILON * 64 + cellStep * 1e-10
  // These are explicit relaxation eligibility limits, not physical failures.
  if (bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY || cellStep <= epsilon * 8 ||
      native.viaPenaltyDistance <= 0 || native.viaDiameter <= 0 || native.FUTURE_CONNECTION_PROXIMITY_VD <= 0 ||
      native.MISALIGNED_DIST_PENALTY_FACTOR < 0 || native.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR < 0 ||
      native.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR < 0 || availableZ.length === 0) {
    cache.diagnostics.reversePotentialIneligibleContexts = (cache.diagnostics.reversePotentialIneligibleContexts ?? 0) + 1
    return null
  }
  // Tile width strictly exceeds one full step. A shortened clamped move
  // stays in its terminal tile; every quotient crossing pays a full component.
  let pitch = cellStep * (1 + 1e-6)
  let columns = 1
  let rows = 1
  // Large ancestor sets use the future-cost relaxation without obstacle-cell
  // removal. This avoids coarsening away its useful penalty structure merely
  // to repeatedly certify the interior of every ancestor capsule.
  const certifyObstacles = native.obstacleSegments.length + native.obstacleVias.length <= 16
  const perCellWork = native.futureConnectionPoints.length +
    (certifyObstacles ? 4 * (native.obstacleSegments.length + native.obstacleVias.length) : 0) + 1
  for (;;) {
    columns = Math.max(1, Math.floor((bounds.maxX - bounds.minX) / pitch))
    rows = Math.max(1, Math.floor((bounds.maxY - bounds.minY) / pitch))
    const count = columns * rows * availableZ.length
    if (count <= 2048 && count * perCellWork <= 50_000) break
    if (columns === 1 && rows === 1) {
      cache.diagnostics.reversePotentialCompileBypasses = (cache.diagnostics.reversePotentialCompileBypasses ?? 0) + 1
      return null
    }
    pitch *= 2
  }
  const pitchX = (bounds.maxX - bounds.minX) / columns
  const pitchY = (bounds.maxY - bounds.minY) / rows
  const count = columns * rows * availableZ.length
  const snapshotWork = count + native.futureConnectionPoints.length +
    native.obstacleSegments.length * 6 + native.obstacleVias.length * 2
  if (!cache.reserveCompilation(snapshotWork, chargeWork)) return null
  const goals = new Uint8Array(count)
  const goalRadius = cellStep * Math.SQRT2 + epsilon
  for (let layer = 0; layer < availableZ.length; layer++) {
    if (availableZ[layer] !== B.z) continue
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const rectangle = {
          minX: bounds.minX + column * pitchX - epsilon,
          maxX: bounds.minX + (column + 1) * pitchX + epsilon,
          minY: bounds.minY + row * pitchY - epsilon,
          maxY: bounds.minY + (row + 1) * pitchY + epsilon,
        }
        if (rectangleDistance(rectangle, B, false) <= goalRadius)
          goals[(layer * rows + row) * columns + column] = 1
      }
    }
  }
  const geometry: ReversePotentialGeometry = {
    key: JSON.stringify(["native6-reverse-v2", native.regionId, native.connectionName,
      bounds, B, availableZ, cellStep, native.viaDiameter, native.traceThickness,
      native.obstacleMargin, native.straightLineDistance, native.viaPenaltyDistance,
      native.FUTURE_CONNECTION_PROXIMITY_VD, native.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR,
      native.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR, certifyObstacles]),
    columns, rows, layers: availableZ, bounds, pitchX, pitchY,
    planarStepCost: cellStep - epsilon * 4,
    planarXCosts: availableZ.map((z) => (z % 2 === 0) !== Boolean(native.FLIP_TRACE_ALIGNMENT_DIRECTION)
      ? 0 : (cellStep - epsilon * 4) * native.MISALIGNED_DIST_PENALTY_FACTOR),
    planarYCosts: availableZ.map((z) => (z % 2 === 0) !== Boolean(native.FLIP_TRACE_ALIGNMENT_DIRECTION)
      ? (cellStep - epsilon * 4) * native.MISALIGNED_DIST_PENALTY_FACTOR : 0),
    viaStepCost: native.viaPenaltyDistance, goals,
  }
  const signature = JSON.stringify([
    native.futureConnectionPoints.map((point) => [point.x, point.y, point.z]),
    native.obstacleSegments.map((segment) => [segment.A.x, segment.A.y, segment.B.x, segment.B.y, segment.z, segment.connectedToCurrentConnection]),
    native.obstacleVias.map((via) => [via.x, via.y]),
  ])
  const exact = cache.lookupExact(geometry, signature)
  if (exact !== null) return exact
  if (!cache.reserveCompilation(count * perCellWork, chargeWork)) return null
  const planarCosts = new Float64Array(count)
  const viaCosts = new Float64Array(count)
  const blocked = new Uint8Array(count)
  const commonMargin = Math.min(native.obstacleMargin, native.viaDiameter / 2)
  const segmentRadius = native.traceThickness + commonMargin - epsilon
  const viaRadius = native.viaDiameter / 2 + native.traceThickness / 2 + commonMargin - epsilon
  for (let layer = 0; layer < availableZ.length; layer++) {
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = (layer * rows + row) * columns + column
        const rectangle: Rectangle = {
          minX: bounds.minX + column * pitchX - epsilon,
          maxX: bounds.minX + (column + 1) * pitchX + epsilon,
          minY: bounds.minY + row * pitchY - epsilon,
          maxY: bounds.minY + (row + 1) * pitchY + epsilon,
        }
        const goalMin = rectangleDistance(rectangle, B, false)
        if (goals[index]) continue
        // The selected point minimizes physical distance + layer penalty.
        // Its physical distance is bounded above by any point's worst score.
        let futureUpper = Infinity
        for (const point of native.futureConnectionPoints) {
          const scoreUpper = rectangleDistance(rectangle, point, true) +
            (point.z !== availableZ[layer] ? native.viaPenaltyDistance : 0)
          futureUpper = Math.min(futureUpper, scoreUpper)
        }
        if (goalMin > futureUpper) {
          const decay = Math.exp(-5 * futureUpper / (native.viaDiameter * native.FUTURE_CONNECTION_PROXIMITY_VD))
          planarCosts[index] = native.straightLineDistance * native.FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR * decay
          viaCosts[index] = native.straightLineDistance * native.FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR * decay
        }
        const corners = [
          { x: rectangle.minX, y: rectangle.minY }, { x: rectangle.minX, y: rectangle.maxY },
          { x: rectangle.maxX, y: rectangle.minY }, { x: rectangle.maxX, y: rectangle.maxY },
        ]
        // A capsule is convex: four interior corners certify the entire cell.
        // Only obstacles rejecting BOTH planar and via arrivals may remove it.
        if (certifyObstacles && (native.obstacleSegments.some((segment) => !segment.connectedToCurrentConnection &&
          segment.z === availableZ[layer] && corners.every((point) => pointToSegmentDistance(point, segment.A, segment.B) < segmentRadius)) ||
          native.obstacleVias.some((via) => corners.every((point) => Math.hypot(point.x - via.x, point.y - via.y) < viaRadius))))
          blocked[index] = 1
      }
    }
  }
  cache.diagnostics.reversePotentialCompiledCells = (cache.diagnostics.reversePotentialCompiledCells ?? 0) + count
  return cache.prepare(geometry, { signature, planarCosts, viaCosts, blocked }, chargeWork)
}
