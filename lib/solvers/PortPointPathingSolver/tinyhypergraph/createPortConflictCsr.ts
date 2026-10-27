export type PortConflictTopology = {
  readonly portCount: number
  readonly portX: ArrayLike<number>
  readonly portY: ArrayLike<number>
  readonly portZ: ArrayLike<number>
}

export type PortConflictCsr = {
  portConflictOffsets: Int32Array
  portConflictPortIds: Int32Array
}

const MAX_INT32 = 0x7fffffff
const DISTANCE_EPSILON = 1e-9

/** Same-plane footprint conflicts, independent of each port's eventual owner. */
export function createPortConflictCsr(
  topology: PortConflictTopology,
  minimumDistance: number,
): PortConflictCsr {
  const { portCount, portX, portY, portZ } = topology
  if (!Number.isSafeInteger(portCount) || portCount < 0 || portCount >= MAX_INT32 ||
    portX.length !== portCount || portY.length !== portCount || portZ.length !== portCount ||
    !Number.isFinite(minimumDistance) || minimumDistance <= 0) {
    throw new Error("Invalid physical port conflict geometry")
  }
  const cellX = new Float64Array(portCount), cellY = new Float64Array(portCount)
  const layers = new Map<number, Map<number, Map<number, number[]>>>()
  for (let port = 0; port < portCount; port++) {
    const x = portX[port]!, y = portY[port]!, z = portZ[port]!
    const cx = Math.floor(x / minimumDistance), cy = Math.floor(y / minimumDistance)
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isSafeInteger(z) || z < 0 ||
      !Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) {
      throw new Error(`Invalid physical port conflict coordinates for port ${port}`)
    }
    cellX[port] = cx; cellY[port] = cy
    let columns = layers.get(z)
    if (!columns) { columns = new Map(); layers.set(z, columns) }
    let rows = columns.get(cx)
    if (!rows) { rows = new Map(); columns.set(cx, rows) }
    let bucket = rows.get(cy)
    if (!bucket) { bucket = []; rows.set(cy, bucket) }
    bucket.push(port)
  }

  const neighbors: Array<readonly number[] | undefined> = new Array(9)
  const heads = new Int32Array(9)
  // Merge nine already-sorted bucket lists. Lower neighbors are emitted in ID
  // order; later port iterations append higher neighbors in ID order as well.
  const visitPairs = (visit: (first: number, second: number) => void): void => {
    for (let port = 0; port < portCount; port++) {
      const columns = layers.get(portZ[port]!)!
      let slot = 0
      for (let dx = -1; dx <= 1; dx++) {
        const rows = columns.get(cellX[port]! + dx)
        for (let dy = -1; dy <= 1; dy++) neighbors[slot++] = rows?.get(cellY[port]! + dy)
      }
      heads.fill(0)
      while (true) {
        let prior = portCount, selected = -1
        for (let index = 0; index < 9; index++) {
          const candidate = neighbors[index]?.[heads[index]!]
          if (candidate !== undefined && candidate < prior) { prior = candidate; selected = index }
        }
        if (selected < 0 || prior >= port) break
        heads[selected]++
        if (Math.hypot(portX[port]! - portX[prior]!, portY[port]! - portY[prior]!) + DISTANCE_EPSILON < minimumDistance) {
          visit(port, prior)
        }
      }
    }
  }

  const degrees = new Int32Array(portCount)
  let entries = 0
  visitPairs((first, second) => {
    if (entries > MAX_INT32 - 2) throw new Error("Physical port conflict graph exceeds Int32 capacity")
    degrees[first]++; degrees[second]++; entries += 2
  })
  const portConflictOffsets = new Int32Array(portCount + 1)
  for (let port = 0; port < portCount; port++) portConflictOffsets[port + 1] = portConflictOffsets[port]! + degrees[port]!
  const portConflictPortIds = new Int32Array(entries)
  const cursors = portConflictOffsets.slice(0, portCount)
  visitPairs((first, second) => {
    portConflictPortIds[cursors[first]!] = second; cursors[first]++
    portConflictPortIds[cursors[second]!] = first; cursors[second]++
  })
  return { portConflictOffsets, portConflictPortIds }
}
