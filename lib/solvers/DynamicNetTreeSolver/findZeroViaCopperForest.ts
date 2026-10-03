import type { CopperConnector } from "./routeDynamicNetTree"
import type { TreePoint } from "./dynamicNetTreeGeometry"

type ForestPoint = TreePoint & { z: number }
type ForestEntry = { cell: number; cost: number }
export type ZeroViaCopperJoin = {
  source: CopperConnector
  target: CopperConnector
  path: ForestPoint[]
  cost: number
  sourceGroup: number
  targetGroup: number
}

class ForestQueue {
  private values: ForestEntry[] = []
  push(entry: ForestEntry): void {
    let i: number = this.values.length
    this.values.push(entry)
    while (i > 0) {
      const parent: number = (i - 1) >> 1,
        previous: ForestEntry = this.values[parent]!
      if (
        previous.cost < entry.cost ||
        (previous.cost === entry.cost && previous.cell <= entry.cell)
      )
        break
      this.values[i] = previous
      i = parent
    }
    this.values[i] = entry
  }
  pop(): ForestEntry | undefined {
    const first: ForestEntry | undefined = this.values[0],
      last: ForestEntry | undefined = this.values.pop()
    if (!last || this.values.length === 0) return first
    let i: number = 0
    while (i * 2 + 1 < this.values.length) {
      let child: number = i * 2 + 1
      const right: ForestEntry | undefined = this.values[child + 1],
        left: ForestEntry = this.values[child]!
      if (
        right &&
        (right.cost < left.cost ||
          (right.cost === left.cost && right.cell < left.cell))
      )
        child++
      const next: ForestEntry = this.values[child]!
      if (
        last.cost < next.cost ||
        (last.cost === next.cost && last.cell <= next.cell)
      )
        break
      this.values[i] = next
      i = child
    }
    this.values[i] = last
    return first
  }
}

/** Multi-source physical wavefronts build a same-layer copper forest before
 * allocating new vias. Labels denote whole existing components, not pins. */
export function findZeroViaCopperForest(
  grid: {
    nx: number
    layerCount: number
    ny: number
    step: number
    point: (cell: number) => ForestPoint
  },
  ports: Map<number, CopperConnector>[],
  edgeLegal: (cell: number, direction: number) => boolean,
  onExpansion: () => void,
): ZeroViaCopperJoin[] {
  const directions = [
    [1, 0],
    [1, 1],
    [0, 1],
    [-1, 1],
    [-1, 0],
    [-1, -1],
    [0, -1],
    [1, -1],
  ] as const
  const plane: number = grid.nx * grid.ny,
    count: number = plane * grid.layerCount
  const distances: Float64Array = new Float64Array(count).fill(Infinity)
  const parents: Int32Array = new Int32Array(count).fill(-2),
    labels: Int32Array = new Int32Array(count).fill(-1),
    origins: Int32Array = new Int32Array(count).fill(-1)
  const settled: Uint8Array = new Uint8Array(count),
    queue: ForestQueue = new ForestQueue()
  const seeds: { group: number; connector: CopperConnector }[] = [],
    best: Map<string, ZeroViaCopperJoin> = new Map()
  function saveJoin(
    source: CopperConnector,
    target: CopperConnector,
    a: number,
    b: number,
    path: ForestPoint[],
    cost: number,
  ): void {
    if (a === b) return
    const key: string = `${Math.min(a, b)}:${Math.max(a, b)}`,
      old: ZeroViaCopperJoin | undefined = best.get(key)
    if (!old || cost < old.cost - 1e-10)
      best.set(key, {
        source,
        target,
        sourceGroup: a,
        targetGroup: b,
        path,
        cost,
      })
  }
  for (const [group, connectors] of ports.entries())
    for (const [cell, connector] of connectors) {
      onExpansion()
      if (cell < 0 || cell >= count || connector.z !== Math.floor(cell / plane))
        throw new Error("Invalid physical forest port")
      const origin: number = seeds.length
      seeds.push({ group, connector })
      if (labels[cell]! >= 0 && labels[cell] !== group) {
        const previous = seeds[origins[cell]!]!
        saveJoin(
          previous.connector,
          connector,
          previous.group,
          group,
          [
            ...previous.connector.path.map(
              (p): ForestPoint => ({ ...p, z: previous.connector.z }),
            ),
            grid.point(cell),
            ...[...connector.path]
              .reverse()
              .map((p): ForestPoint => ({ ...p, z: connector.z })),
          ],
          distances[cell]! + connector.cost,
        )
      }
      if (
        connector.cost < distances[cell]! - 1e-10 ||
        (Math.abs(connector.cost - distances[cell]!) < 1e-10 &&
          group < labels[cell]!)
      ) {
        distances[cell] = connector.cost
        parents[cell] = -1
        labels[cell] = group
        origins[cell] = origin
        queue.push({ cell, cost: connector.cost })
      }
    }
  function gridPath(cell: number): ForestPoint[] {
    const path: ForestPoint[] = [],
      group: number = labels[cell]!
    while (true) {
      if (!settled[cell] || labels[cell] !== group || parents[cell] === -2)
        throw new Error("Unsettled or mixed physical forest predecessor")
      path.push(grid.point(cell))
      if (parents[cell] === -1) break
      cell = parents[cell]!
      if (path.length > count)
        throw new Error("Physical forest predecessor cycle")
    }
    return path
  }
  while (true) {
    const entry: ForestEntry | undefined = queue.pop()
    if (!entry) break
    if (entry.cost !== distances[entry.cell] || settled[entry.cell]) continue
    settled[entry.cell] = 1
    onExpansion()
    const cell: number = entry.cell,
      x: number = cell % grid.nx,
      y: number = Math.floor((cell % plane) / grid.nx),
      z: number = Math.floor(cell / plane)
    for (let direction = 0; direction < 8; direction++) {
      const [dx, dy] = directions[direction]!,
        xx: number = x + dx,
        yy: number = y + dy
      if (
        xx < 0 ||
        yy < 0 ||
        xx >= grid.nx ||
        yy >= grid.ny ||
        !edgeLegal(cell, direction)
      )
        continue
      const next: number = z * plane + yy * grid.nx + xx,
        length: number = grid.step * (dx && dy ? Math.SQRT2 : 1)
      if (settled[next]) {
        if (labels[next] === labels[cell]) continue
        const cost: number = distances[cell]! + length + distances[next]!,
          key: string = `${Math.min(labels[cell]!, labels[next]!)}:${Math.max(labels[cell]!, labels[next]!)}`
        if (best.has(key) && best.get(key)!.cost <= cost + 1e-10) continue
        const source = seeds[origins[cell]!]!,
          target = seeds[origins[next]!]!
        saveJoin(
          source.connector,
          target.connector,
          source.group,
          target.group,
          [
            ...source.connector.path.map((p): ForestPoint => ({ ...p, z })),
            ...gridPath(cell).reverse(),
            ...gridPath(next),
            ...[...target.connector.path]
              .reverse()
              .map((p): ForestPoint => ({ ...p, z })),
          ],
          cost,
        )
        continue
      }
      const cost: number = entry.cost + length
      if (
        cost < distances[next]! - 1e-10 ||
        (Math.abs(cost - distances[next]!) < 1e-10 &&
          labels[cell]! < labels[next]!)
      ) {
        distances[next] = cost
        parents[next] = cell
        labels[next] = labels[cell]!
        origins[next] = origins[cell]!
        queue.push({ cell: next, cost })
      }
    }
  }
  return [...best.values()].sort(
    (a, b): number =>
      a.cost - b.cost ||
      a.sourceGroup - b.sourceGroup ||
      a.targetGroup - b.targetGroup,
  )
}
