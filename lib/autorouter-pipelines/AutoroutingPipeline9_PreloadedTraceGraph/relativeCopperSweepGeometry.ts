export type CopperPoint = { x: number; y: number }
export type CopperSweep = { radius: number } & ({ points: CopperPoint[] } | { box: { center: CopperPoint; halfWidth: number[]; halfHeight: number[] } })
type ExactPoint = { x: bigint; y: bigint }

// An integer grid is used only as an exact representation of binary64 inputs,
// never to snap geometry. Extremely small external values are unsupported.
const SCALE_EXPONENT = 128
const buffer = new ArrayBuffer(8)
const view = new DataView(buffer)
const exactCache = new Map<number, bigint>()

function exact(value: number): bigint {
  const cached = exactCache.get(value)
  if (cached !== undefined) return cached
  if (!Number.isFinite(value)) throw new Error("Relative copper proof requires finite geometry")
  if (value === 0) return 0n
  view.setFloat64(0, value, false)
  const bits = view.getBigUint64(0, false)
  let exponent = Number((bits >> 52n) & 2047n) - 1023 - 52
  let mantissa = (bits & ((1n << 52n) - 1n)) | (1n << 52n)
  while (exponent < -SCALE_EXPONENT && (mantissa & 1n) === 0n) { mantissa >>= 1n; exponent++ }
  if (exponent < -SCALE_EXPONENT || exponent > 128) {
    throw new Error("Relative copper proof geometry is outside its exact arithmetic domain")
  }
  const result = ((bits >> 63n) === 0n ? mantissa : -mantissa) << BigInt(exponent + SCALE_EXPONENT)
  if (exactCache.size >= 8192) exactCache.clear()
  exactCache.set(value, result)
  return result
}

/** Strict separating-axis certificate for closed convex swept capsules.
 * Each core is the convex hull of its listed points, enlarged by its radius.
 * Candidate axes can be incomplete: that produces false/UNKNOWN, never PASS.
 */
export function areCopperSweepsSeparated(a: CopperSweep, b: CopperSweep, margin = 0): boolean {
  if (a.radius < 0 || b.radius < 0 || margin < 0) {
    throw new Error("Relative copper proof received an invalid swept envelope")
  }
  const convert = (point: CopperPoint): ExactPoint => ({ x: exact(point.x), y: exact(point.y) })
  const core = (value: CopperSweep): ExactPoint[] => {
    if ("points" in value) {
      if (value.points.length === 0) throw new Error("Relative copper sweep has an empty core")
      return value.points.map(convert)
    }
    const center = convert(value.box.center)
    const width = value.box.halfWidth.reduce((total, term) => total + exact(term), 0n)
    const height = value.box.halfHeight.reduce((total, term) => total + exact(term), 0n)
    if (width <= 0n || height <= 0n) throw new Error("Relative copper sweep has invalid outer bounds")
    return [-1n, 1n].flatMap((x) => [-1n, 1n].map((y) => ({ x: center.x + x * width, y: center.y + y * height })))
  }
  const left = core(a), right = core(b)
  const radius = exact(a.radius) + exact(b.radius) + exact(margin)
  const separated = (axis: ExactPoint): boolean => {
    const norm = axis.x * axis.x + axis.y * axis.y
    if (norm === 0n) return false
    const project = (point: ExactPoint): bigint => point.x * axis.x + point.y * axis.y
    const l = left.map(project), r = right.map(project)
    const minimum = (values: bigint[]): bigint => values.reduce((x, y) => x < y ? x : y)
    const maximum = (values: bigint[]): bigint => values.reduce((x, y) => x > y ? x : y)
    const gapA = minimum(r) - maximum(l), gapB = minimum(l) - maximum(r)
    const gap = gapA > gapB ? gapA : gapB
    return gap > 0n && gap * gap > radius * radius * norm
  }
  if (separated({ x: 1n, y: 0n }) || separated({ x: 0n, y: 1n })) return true
  for (const points of [left, right]) {
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      const dx = points[j]!.x - points[i]!.x, dy = points[j]!.y - points[i]!.y
      if (separated({ x: -dy, y: dx })) return true
    }
  }
  for (const p of left) for (const q of right) {
    if (separated({ x: q.x - p.x, y: q.y - p.y })) return true
  }
  return false
}

/** Exact interior test for an unchanged wire disk in one solid SMT land. */
export function isWireDiskInsideSmtLand(point: CopperPoint, radius: number, pad: {
  type: string; center: CopperPoint; width: number; height: number; shape?: string; ccwRotationDegrees?: number
}, margin = 0): boolean {
  if (pad.type !== "rect" || radius <= 0 || margin < 0 || pad.width <= 0 || pad.height <= 0 || (pad.ccwRotationDegrees ?? 0) !== 0) return false
  const dx = exact(point.x) - exact(pad.center.x), dy = exact(point.y) - exact(pad.center.y)
  const r = exact(radius) + exact(margin)
  const w = exact(pad.width / 2), h = exact(pad.height / 2)
  if (pad.shape === "circle") {
    const remaining = w - r
    return pad.width === pad.height && remaining > 0n && dx * dx + dy * dy < remaining * remaining
  }
  const abs = (value: bigint): bigint => value < 0n ? -value : value
  return (pad.shape === undefined || pad.shape === "rect") && abs(dx) + r < w && abs(dy) + r < h
}

/** Exact hard cap; no floating square root or enlarged acceptance threshold. */
export function isCopperPointWithinRadius(a: CopperPoint, b: CopperPoint, radius: number): boolean {
  if (!Number.isFinite(radius) || radius < 0) throw new Error("Invalid relative movement radius")
  const dx = exact(a.x) - exact(b.x), dy = exact(a.y) - exact(b.y)
  const r = exact(radius)
  return dx * dx + dy * dy <= r * r
}
