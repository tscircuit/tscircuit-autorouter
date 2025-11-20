// lib/solvers/rectdiff/engine.ts
import type {
  GridFill3DOptions,
  Placed3D,
  Rect3d,
  RectDiffState,
  XYRect,
} from "./types"
import type { SimpleRouteJson } from "lib/types/srj-types"
import {
  computeCandidates3D,
  computeDefaultGridSizes,
  computeEdgeCandidates3D,
  longestFreeSpanAroundZ,
} from "./candidates"
import {
  EPS,
  containsPoint,
  expandRectFromSeed,
  overlaps,
  subtractRect2D,
} from "./geometry"
import { buildZIndexMap, obstacleToXYRect, obstacleZs } from "./layers"

export function initState(
  srj: SimpleRouteJson,
  opts: Partial<GridFill3DOptions>,
): RectDiffState {
  const { layerNames, zIndexByName } = buildZIndexMap(srj)
  const layerCount = Math.max(1, layerNames.length, srj.layerCount || 1)

  const bounds: XYRect = {
    x: srj.bounds.minX,
    y: srj.bounds.minY,
    width: srj.bounds.maxX - srj.bounds.minX,
    height: srj.bounds.maxY - srj.bounds.minY,
  }

  // Obstacles per layer
  const obstaclesByLayer: XYRect[][] = Array.from(
    { length: layerCount },
    () => [],
  )
  for (const ob of srj.obstacles ?? []) {
    const r = obstacleToXYRect(ob)
    if (!r) continue
    const zs = obstacleZs(ob, zIndexByName)
    for (const z of zs)
      if (z >= 0 && z < layerCount) obstaclesByLayer[z]!.push(r)
  }

  const trace = Math.max(0.01, srj.minTraceWidth || 0.15)
  const defaults: Required<
    Omit<GridFill3DOptions, "gridSizes" | "maxMultiLayerSpan">
  > & {
    gridSizes: number[]
    maxMultiLayerSpan: number | undefined
  } = {
    gridSizes: computeDefaultGridSizes(bounds),
    initialCellRatio: 0.2,
    maxAspectRatio: 3,
    minSingle: { width: 2 * trace, height: 2 * trace },
    minMulti: {
      width: 4 * trace,
      height: 4 * trace,
      minLayers: Math.min(2, Math.max(1, srj.layerCount || 1)),
    },
    preferMultiLayer: true,
    maxMultiLayerSpan: undefined,
  }

  const options = {
    ...defaults,
    ...opts,
    gridSizes: opts.gridSizes ?? defaults.gridSizes,
  }

  const placedByLayer: XYRect[][] = Array.from({ length: layerCount }, () => [])

  // Begin at the **first** grid level; candidates computed lazily on first step
  return {
    srj,
    layerNames,
    layerCount,
    bounds,
    options,
    obstaclesByLayer,
    phase: "GRID",
    gridIndex: 0,
    candidates: [],
    placed: [],
    placedByLayer,
    expansionIndex: 0,
    edgeAnalysisDone: false,
    totalSeedsThisGrid: 0,
    consumedSeedsThisGrid: 0,
  }
}

// Build per-layer list of "hard" placed rects = nodes spanning all layers
function buildHardPlacedByLayer(state: RectDiffState): XYRect[][] {
  const out: XYRect[][] = Array.from({ length: state.layerCount }, () => [])
  for (const p of state.placed) {
    if (p.zLayers.length >= state.layerCount) {
      for (const z of p.zLayers) out[z]!.push(p.rect)
    }
  }
  return out
}

function isFullyOccupiedAtPoint(
  state: RectDiffState,
  x: number,
  y: number,
): boolean {
  for (let z = 0; z < state.layerCount; z++) {
    const obs = state.obstaclesByLayer[z] ?? []
    const placed = state.placedByLayer[z] ?? []
    const occ =
      obs.some((b) => containsPoint(b, x, y)) ||
      placed.some((b) => containsPoint(b, x, y))
    if (!occ) return false
  }
  return true
}

/** Shrink/split any *soft* (non-full-stack) nodes overlapped by `newIndex` */
function resizeSoftOverlaps(state: RectDiffState, newIndex: number) {
  const newcomer = state.placed[newIndex]!
  const { rect: newR, zLayers: newZs } = newcomer
  const layerCount = state.layerCount

  const removeIdx: number[] = []
  const toAdd: typeof state.placed = []

  for (let i = 0; i < state.placed.length; i++) {
    if (i === newIndex) continue
    const old = state.placed[i]!
    // Protect full-stack nodes
    if (old.zLayers.length >= layerCount) continue

    const sharedZ = old.zLayers.filter((z) => newZs.includes(z))
    if (sharedZ.length === 0) continue
    if (!overlaps(old.rect, newR)) continue

    // Carve the overlap on the shared layers
    const parts = subtractRect2D(old.rect, newR)

    // We will replace `old` entirely; re-add unaffected layers (same rect object).
    removeIdx.push(i)

    const unaffectedZ = old.zLayers.filter((z) => !newZs.includes(z))
    if (unaffectedZ.length > 0) {
      toAdd.push({ rect: old.rect, zLayers: unaffectedZ })
    }

    // Re-add carved pieces for affected layers, dropping tiny slivers
    const minW = Math.min(
      state.options.minSingle.width,
      state.options.minMulti.width,
    )
    const minH = Math.min(
      state.options.minSingle.height,
      state.options.minMulti.height,
    )
    for (const p of parts) {
      if (p.width + EPS >= minW && p.height + EPS >= minH) {
        toAdd.push({ rect: p, zLayers: sharedZ.slice() })
      }
    }
  }

  // Remove (and clear placedByLayer)
  removeIdx
    .sort((a, b) => b - a)
    .forEach((idx) => {
      const rem = state.placed.splice(idx, 1)[0]!
      for (const z of rem.zLayers) {
        const arr = state.placedByLayer[z]!
        const j = arr.findIndex((r) => r === rem.rect)
        if (j >= 0) arr.splice(j, 1)
      }
    })

  // Add replacements
  for (const p of toAdd) {
    state.placed.push(p)
    for (const z of p.zLayers) state.placedByLayer[z]!.push(p.rect)
  }
}

/** One micro-step during the GRID phase: handle (or fetch) exactly one candidate */
export function stepGrid(state: RectDiffState): void {
  const {
    gridSizes,
    initialCellRatio,
    maxAspectRatio,
    minSingle,
    minMulti,
    preferMultiLayer,
    maxMultiLayerSpan,
  } = state.options
  const grid = gridSizes[state.gridIndex]!

  // Build hard-placed map once per micro-step (cheap)
  const hardPlacedByLayer = buildHardPlacedByLayer(state)

  // Ensure candidates exist for this grid
  if (state.candidates.length === 0 && state.consumedSeedsThisGrid === 0) {
    state.candidates = computeCandidates3D(
      state.bounds,
      grid,
      state.layerCount,
      state.obstaclesByLayer,
      state.placedByLayer, // all nodes (soft + hard) for fully-occupied test
      hardPlacedByLayer, // hard blockers for ranking/span
    )
    state.totalSeedsThisGrid = state.candidates.length
    state.consumedSeedsThisGrid = 0
  }

  // If no candidates remain, advance grid or run edge pass or switch phase
  if (state.candidates.length === 0) {
    if (state.gridIndex + 1 < gridSizes.length) {
      state.gridIndex += 1
      state.totalSeedsThisGrid = 0
      state.consumedSeedsThisGrid = 0
      return
    } else {
      if (!state.edgeAnalysisDone) {
        const minSize = Math.min(minSingle.width, minSingle.height)
        state.candidates = computeEdgeCandidates3D(
          state.bounds,
          minSize,
          state.layerCount,
          state.obstaclesByLayer,
          state.placedByLayer, // for fully-occupied test
          hardPlacedByLayer,
        )
        state.edgeAnalysisDone = true
        state.totalSeedsThisGrid = state.candidates.length
        state.consumedSeedsThisGrid = 0
        return
      }
      state.phase = "EXPANSION"
      state.expansionIndex = 0
      return
    }
  }

  // Consume exactly one candidate
  const cand = state.candidates.shift()!
  state.consumedSeedsThisGrid += 1

  // Evaluate attempts — multi-layer span first (computed ignoring soft nodes)
  const span = longestFreeSpanAroundZ(
    cand.x,
    cand.y,
    cand.z,
    state.layerCount,
    minMulti.minLayers,
    maxMultiLayerSpan,
    state.obstaclesByLayer,
    hardPlacedByLayer, // ignore soft nodes for span
  )

  const attempts: Array<{
    kind: "multi" | "single"
    layers: number[]
    minReq: { width: number; height: number }
  }> = []

  if (span.length >= minMulti.minLayers) {
    attempts.push({
      kind: "multi",
      layers: span,
      minReq: { width: minMulti.width, height: minMulti.height },
    })
  }
  attempts.push({
    kind: "single",
    layers: [cand.z],
    minReq: { width: minSingle.width, height: minSingle.height },
  })

  const ordered = preferMultiLayer ? attempts : attempts.reverse()

  for (const attempt of ordered) {
    // HARD blockers only: obstacles on those layers + full-stack nodes
    const hardBlockers: XYRect[] = []
    for (const z of attempt.layers) {
      if (state.obstaclesByLayer[z])
        hardBlockers.push(...state.obstaclesByLayer[z]!)
      if (hardPlacedByLayer[z]) hardBlockers.push(...hardPlacedByLayer[z]!)
    }

    const rect = expandRectFromSeed(
      cand.x,
      cand.y,
      grid,
      state.bounds,
      hardBlockers, // soft nodes DO NOT block expansion
      initialCellRatio,
      maxAspectRatio,
      attempt.minReq,
    )
    if (!rect) continue

    // Place the new node
    const placed: Placed3D = { rect, zLayers: [...attempt.layers] }
    const newIndex = state.placed.push(placed) - 1
    for (const z of attempt.layers) state.placedByLayer[z]!.push(rect)

    // New: carve overlapped soft nodes
    resizeSoftOverlaps(state, newIndex)

    // New: relax candidate culling — only drop seeds that became fully occupied
    state.candidates = state.candidates.filter(
      (c) => !isFullyOccupiedAtPoint(state, c.x, c.y),
    )

    return // processed one candidate
  }

  // Neither attempt worked; drop this candidate for now.
}

/** One micro-step during the EXPANSION phase: expand exactly one placed rect */
export function stepExpansion(state: RectDiffState): void {
  if (state.expansionIndex >= state.placed.length) {
    state.phase = "DONE"
    return
  }

  const idx = state.expansionIndex
  const p = state.placed[idx]!
  const lastGrid = state.options.gridSizes[state.options.gridSizes.length - 1]!

  const hardPlacedByLayer = buildHardPlacedByLayer(state)

  // HARD blockers only: obstacles on p.zLayers + full-stack nodes
  const hardBlockers: XYRect[] = []
  for (const z of p.zLayers) {
    hardBlockers.push(...(state.obstaclesByLayer[z] ?? []))
    hardBlockers.push(...(hardPlacedByLayer[z] ?? []))
  }

  const oldRect = p.rect
  const expanded = expandRectFromSeed(
    p.rect.x + p.rect.width / 2,
    p.rect.y + p.rect.height / 2,
    lastGrid,
    state.bounds,
    hardBlockers,
    0, // seed bias off
    null, // no aspect cap in expansion pass
    { width: p.rect.width, height: p.rect.height },
  )

  if (expanded) {
    // Update placement + per-layer index (replace old rect object)
    state.placed[idx] = { rect: expanded, zLayers: p.zLayers }
    for (const z of p.zLayers) {
      const arr = state.placedByLayer[z]!
      const j = arr.findIndex((r) => r === oldRect)
      if (j >= 0) arr[j] = expanded
    }

    // Carve overlapped soft neighbors (respect full-stack nodes)
    resizeSoftOverlaps(state, idx)
  }

  state.expansionIndex += 1
}

export function finalizeRects(state: RectDiffState): Rect3d[] {
  return state.placed.map((p) => ({
    minX: p.rect.x,
    minY: p.rect.y,
    maxX: p.rect.x + p.rect.width,
    maxY: p.rect.y + p.rect.height,
    zLayers: [...p.zLayers].sort((a, b) => a - b),
  }))
}

/** Optional: rough progress number for BaseSolver.progress */
export function computeProgress(state: RectDiffState): number {
  const grids = state.options.gridSizes.length
  if (state.phase === "GRID") {
    const g = state.gridIndex
    const base = g / (grids + 1) // reserve final slice for expansion
    const denom = Math.max(1, state.totalSeedsThisGrid)
    const frac = denom ? state.consumedSeedsThisGrid / denom : 1
    return Math.min(0.999, base + frac * (1 / (grids + 1)))
  }
  if (state.phase === "EXPANSION") {
    const base = grids / (grids + 1)
    const denom = Math.max(1, state.placed.length)
    const frac = denom ? state.expansionIndex / denom : 1
    return Math.min(0.999, base + frac * (1 / (grids + 1)))
  }
  return 1
}
