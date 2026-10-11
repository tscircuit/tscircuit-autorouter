import type { HighDensityRoute } from "../../types/high-density-types"

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
export type ParallelPathBatches = {
  interactionComponentCount: number
  batches: number[][]
}

/**
 * Path sampling and vertex shortcuts only join points inside the original XY
 * bounds. Vias keep their XY positions. Expand both route bounds by the largest
 * copper radius plus the path solver's 0.1 mm clearance, on every layer. Any
 * route that might influence a shortcut must therefore belong to the same
 * component. Jumper pads use footprint geometry, so keep jumper boards together.
 */
export function getParallelPathBatches(
  routes: ReadonlyArray<HighDensityRoute>,
  useTraceWidthAwareClearance: boolean,
  workerCount: number,
): ParallelPathBatches {
  if (routes.some((route) => route.jumpers?.length)) {
    return { interactionComponentCount: routes.length > 0 ? 1 : 0, batches: routes.length > 0 ? [routes.map((_, index) => index)] : [] }
  }
  let maximumCopperRadius = 0.15 / 2
  for (const route of routes) {
    maximumCopperRadius = Math.max(maximumCopperRadius, route.viaDiameter / 2)
    if (useTraceWidthAwareClearance) {
      maximumCopperRadius = Math.max(maximumCopperRadius, route.traceThickness / 2)
      for (const point of route.route) {
        maximumCopperRadius = Math.max(maximumCopperRadius, (point.traceThickness ?? route.traceThickness) / 2)
      }
    }
  }
  const expansion = maximumCopperRadius + 0.1 + 1e-9
  const bounds: Bounds[] = routes.map((route) => {
    const box: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
    for (const point of [...route.route, ...route.vias]) {
      box.minX = Math.min(box.minX, point.x - expansion)
      box.minY = Math.min(box.minY, point.y - expansion)
      box.maxX = Math.max(box.maxX, point.x + expansion)
      box.maxY = Math.max(box.maxY, point.y + expansion)
    }
    return box
  })
  const parent = routes.map((_, index) => index)
  for (let left = 0; left < routes.length; left++) {
    for (let right = left + 1; right < routes.length; right++) {
      const a = bounds[left]
      const b = bounds[right]
      if (a.minX > b.maxX || a.maxX < b.minX || a.minY > b.maxY || a.maxY < b.minY) continue
      let leftRoot = left
      let rightRoot = right
      while (parent[leftRoot] !== leftRoot) leftRoot = parent[leftRoot]
      while (parent[rightRoot] !== rightRoot) rightRoot = parent[rightRoot]
      if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot
    }
  }
  const componentMap = new Map<number, number[]>()
  for (let index = 0; index < routes.length; index++) {
    let root = index
    while (parent[root] !== root) root = parent[root]
    const component = componentMap.get(root) ?? []
    component.push(index)
    componentMap.set(root, component)
  }
  const components = [...componentMap.values()].map((indexes) => ({
    indexes,
    weight: indexes.reduce((total, index) => total + routes[index].route.length + routes[index].vias.length * 8 + 1, 0),
  })).sort((left, right) => right.weight - left.weight || left.indexes[0] - right.indexes[0])
  const bins = Array.from({ length: Math.min(workerCount, components.length) }, () => ({ weight: 0, indexes: [] as number[] }))
  for (const component of components) {
    let target = bins[0]
    for (const bin of bins) if (bin.weight < target.weight) target = bin
    target.indexes.push(...component.indexes)
    target.weight += component.weight
  }
  return {
    interactionComponentCount: components.length,
    batches: bins.map((bin) => bin.indexes.sort((left, right) => left - right)),
  }
}
