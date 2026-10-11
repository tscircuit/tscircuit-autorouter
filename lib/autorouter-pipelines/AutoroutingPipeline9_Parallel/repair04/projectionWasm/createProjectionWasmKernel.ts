import type {
  ProjectionBatchExecutor,
  ProjectionSweepGeometry,
} from "../Pipeline9IndexedRelaxTraceClearanceSolver"
import { projectionKernelBytes } from "./projectionKernelBytes"

const VERTEX_STRIDE = 12
const PAIR_STRIDE = 24
const PAD_STRIDE = 32
const SEGMENT_STRIDE = 12
const MAX_BYTES = 512 * 1024 * 1024
const MAX_COORDINATE = 10_000
let compiledModule: WebAssembly.Module | undefined
const nativeIntrinsics = [
  [Math, "min", Math.min], [Math, "max", Math.max],
  [Math, "sqrt", Math.sqrt], [Math, "abs", Math.abs],
  // Physical guard callbacks must also see native peers and execution order.
  [Math, "hypot", Math.hypot], [Object, "is", Object.is],
  [Array.prototype, "indexOf", Array.prototype.indexOf],
  [Array.prototype, "some", Array.prototype.some],
  [Array.prototype, "map", Array.prototype.map],
  [Array.prototype, "reduce", Array.prototype.reduce],
  [Array.prototype, Symbol.iterator, Array.prototype[Symbol.iterator]],
  [Map.prototype, "get", Map.prototype.get],
] as const

function hasNativeIntrinsics(): boolean {
  for (let index = 0; index < nativeIntrinsics.length; index++) {
    const entry = nativeIntrinsics[index]!
    const owner = entry[0], name = entry[1], native = entry[2]
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)
    if (!descriptor || descriptor.get || descriptor.set || descriptor.value !== native)
      return false
  }
  return true
}

export type ProjectionKernelDiagnostics = {
  enabled: boolean
  batches: number
  guardCalls: number
  fallbackReason?: string
}

type KernelExports = {
  memory: WebAssembly.Memory
  __heap_base: WebAssembly.Global
  batch: (
    vertices: number, segments: number, pairs: number, pads: number,
    pairStart: number, pairEnd: number, padStart: number, padEnd: number,
    rejectSeparatedPairs: number, cursor: number,
  ) => void
}

/** Restrict the native arithmetic to its finite, bounded preparation domain. */
function isEligible(geometry: ProjectionSweepGeometry): boolean {
  const finite = (value: number): boolean =>
    Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE
  const vertices = new Set(geometry.vertices)
  if (vertices.size !== geometry.vertices.length) return false
  const segments = new Set(geometry.segments)
  if (segments.size !== geometry.segments.length || geometry.segments.some(
    (segment): boolean => !vertices.has(segment.a) || !vertices.has(segment.b),
  )) return false
  for (const vertex of geometry.vertices) {
    if (![vertex.x, vertex.y, vertex.original.x, vertex.original.y,
      vertex.bounds.minX, vertex.bounds.maxX,
      vertex.bounds.minY, vertex.bounds.maxY].every(finite) ||
      !Number.isSafeInteger(vertex.revision) || vertex.revision < 0 ||
      vertex.bounds.minX > vertex.bounds.maxX ||
      vertex.bounds.minY > vertex.bounds.maxY) return false
  }
  for (const pair of geometry.pairs) {
    if (!segments.has(pair.a) || !segments.has(pair.b) ||
      ![pair.a.a, pair.a.b, pair.b.a, pair.b.b].every(
      (vertex): boolean => vertices.has(vertex),
    ) || !finite(pair.required) || pair.required < 0 ||
      !Number.isFinite(pair.separationDistanceSquared) ||
      pair.separationDistanceSquared < 0 ||
      pair.revisions.some((revision): boolean =>
        !Number.isSafeInteger(revision) || revision < -1)) return false
  }
  for (const pad of geometry.padContacts) {
    if (!segments.has(pad.segment) || !vertices.has(pad.segment.a) || !vertices.has(pad.segment.b) ||
      pad.corners.length !== 4 || !finite(pad.required) || pad.required < 0 ||
      !pad.corners.every((point): boolean => finite(point.x) && finite(point.y)) ||
      [...pad.revisions, ...pad.interiorRevisions].some((revision): boolean =>
        !Number.isSafeInteger(revision) || revision < -1)) return false
  }
  return true
}

/**
 * One instance owns one immutable topology and its mutable F64 coordinates.
 * Native JS keeps all physical via-pad distance/tangent queries, in their
 * original order, at the exact proposed coordinates produced by the kernel.
 */
export function createProjectionWasmKernel(
  geometry: ProjectionSweepGeometry,
  diagnostics: ProjectionKernelDiagnostics,
): ProjectionBatchExecutor | undefined {
  if (!hasNativeIntrinsics() || !geometry.hasNativeProjectionHooks() || !isEligible(geometry)) {
    diagnostics.fallbackReason = "outside finite native kernel domain"
    return undefined
  }
  if (typeof WebAssembly === "undefined") {
    diagnostics.fallbackReason = "WebAssembly unavailable"
    return undefined
  }
  const { vertices, segments, pairs, padContacts } = geometry
  const bytes = vertices.length * VERTEX_STRIDE * 8 +
    segments.length * SEGMENT_STRIDE * 8 +
    pairs.length * PAIR_STRIDE * 8 + padContacts.length * PAD_STRIDE * 8 + 16
  if (!Number.isSafeInteger(bytes) || bytes > MAX_BYTES - 1024 * 1024) {
    diagnostics.fallbackReason = "native kernel memory bound"
    return undefined
  }
  compiledModule ??= new WebAssembly.Module(projectionKernelBytes)
  let memory: Float64Array
  let vertexOffset = 0
  let cursorOffset = 0
  const instance = new WebAssembly.Instance(compiledModule, {
    env: {
      guard_vertex: (
        index: number, x: number, y: number, tangents: number,
      ): void => {
        diagnostics.guardCalls++
        geometry.commitConstraintCursor(memory[cursorOffset]!, memory[cursorOffset + 1]!)
        const vertex = vertices[index]!
        const offset = vertexOffset + index * VERTEX_STRIDE
        vertex.x = memory[offset]!
        vertex.y = memory[offset + 1]!
        vertex.revision = memory[offset + 5]!
        try {
          geometry.projectVertex(vertex, x, y, tangents !== 0)
        } finally {
          memory[offset] = vertex.x
          memory[offset + 1] = vertex.y
          memory[offset + 5] = vertex.revision
        }
      },
    },
  })
  const exports = instance.exports as unknown as KernelExports
  const heap = Math.ceil(Number(exports.__heap_base.value) / 8) * 8
  const vertexPointer = heap
  const segmentPointer = vertexPointer + vertices.length * VERTEX_STRIDE * 8
  const pairPointer = segmentPointer + segments.length * SEGMENT_STRIDE * 8
  const padPointer = pairPointer + pairs.length * PAIR_STRIDE * 8
  const cursorPointer = padPointer + padContacts.length * PAD_STRIDE * 8
  const pages = Math.ceil((cursorPointer + 16) / 65536)
  if (pages * 65536 > MAX_BYTES)
    throw new Error("Projection kernel heap exceeds validated memory bound")
  const allocatedPages = exports.memory.buffer.byteLength / 65536
  if (pages > allocatedPages) exports.memory.grow(pages - allocatedPages)
  // Memory.grow detaches previous views. Allocate the only view after growth.
  memory = new Float64Array(exports.memory.buffer)
  vertexOffset = vertexPointer / 8
  cursorOffset = cursorPointer / 8
  const vertexIds = new Map(vertices.map((vertex, index): [typeof vertex, number] =>
    [vertex, index]))
  const segmentIds = new Map(segments.map((segment, index): [typeof segment, number] =>
    [segment, index]))
  segments.forEach((segment, index): void => {
    const cache = segment.boundsCache
    if (cache) memory.set([
      cache.aX, cache.aY, cache.bX, cache.bY,
      cache.minX, cache.maxX, cache.minY, cache.maxY, 1,
    ], segmentPointer / 8 + index * SEGMENT_STRIDE)
  })
  vertices.forEach((vertex, index): void => {
    memory.set([
      vertex.x, vertex.y, vertex.original.x, vertex.original.y,
      Number(vertex.locked), vertex.revision,
      vertex.bounds.minX, vertex.bounds.maxX, vertex.bounds.minY, vertex.bounds.maxY,
      Number(geometry.viaPadConstraints.has(vertex)), 0,
    ], vertexOffset + index * VERTEX_STRIDE)
  })
  pairs.forEach((pair, index): void => {
    const offset = pairPointer / 8 + index * PAIR_STRIDE
    memory.set([
      vertexIds.get(pair.a.a)!, vertexIds.get(pair.a.b)!,
      vertexIds.get(pair.b.a)!, vertexIds.get(pair.b.b)!,
      ...pair.revisions, pair.required, pair.separationDistanceSquared,
      Number(pair.a.via && pair.b.via), Number(pair.separated),
    ], offset)
    if (pair.contact) memory.set([
      pair.contact.s, pair.contact.t, pair.contact.x, pair.contact.y, pair.contact.distance,
    ], offset + 12)
    memory.set([
      segmentIds.get(pair.a)!, segmentIds.get(pair.b)!, Number(Boolean(pair.contact)),
      ...pair.weights.map((entry): number => entry[1]),
    ], offset + 17)
  })
  padContacts.forEach((pad, index): void => {
    const offset = padPointer / 8 + index * PAD_STRIDE
    memory.set([
      vertexIds.get(pad.segment.a)!, vertexIds.get(pad.segment.b)!,
      pad.required, ...pad.revisions, ...pad.interiorRevisions,
      ...pad.corners.flatMap((point): number[] => [point.x, point.y]),
    ], offset)
    if (pad.contact) memory.set([
      pad.contact.s, pad.contact.t, pad.contact.x, pad.contact.y, pad.contact.distance,
    ], offset + 15)
    pad.interiors.forEach((interior, endpoint): void => {
      if (interior) memory.set([1, interior.x, interior.y, interior.depth],
        offset + 20 + endpoint * 4)
    })
    memory.set([pad.weights[0]![1], pad.weights[1]![1], Number(Boolean(pad.contact))], offset + 28)
  })
  diagnostics.enabled = true
  return {
    isCompatible: (): boolean => hasNativeIntrinsics() && geometry.hasNativeProjectionHooks(),
    restoreNativeState: (): void => {
      // A mid-sweep method/intrinsic replacement must see the original cached
      // observations, not a newly recomputed contact under the replacement.
      diagnostics.enabled = false
      diagnostics.fallbackReason = "native execution changed between batches"
      segments.forEach((segment, index): void => {
        const offset = segmentPointer / 8 + index * SEGMENT_STRIDE
        segment.boundsCache = memory[offset + 8] ? {
          aX: memory[offset]!, aY: memory[offset + 1]!,
          bX: memory[offset + 2]!, bY: memory[offset + 3]!,
          minX: memory[offset + 4]!, maxX: memory[offset + 5]!,
          minY: memory[offset + 6]!, maxY: memory[offset + 7]!,
        } : undefined
      })
      pairs.forEach((pair, index): void => {
        const offset = pairPointer / 8 + index * PAIR_STRIDE
        for (let i = 0; i < 4; i++) {
          pair.revisions[i] = memory[offset + 4 + i]!
          pair.weights[i]![1] = memory[offset + 20 + i]!
        }
        pair.separated = Boolean(memory[offset + 11])
        pair.contact = memory[offset + 19] ? {
          s: memory[offset + 12]!, t: memory[offset + 13]!,
          x: memory[offset + 14]!, y: memory[offset + 15]!,
          distance: memory[offset + 16]!,
        } : null
      })
      padContacts.forEach((pad, index): void => {
        const offset = padPointer / 8 + index * PAD_STRIDE
        for (let i = 0; i < 2; i++) {
          pad.revisions[i] = memory[offset + 3 + i]!
          pad.interiorRevisions[i] = memory[offset + 5 + i]!
          const interior = offset + 20 + i * 4
          pad.interiors[i] = memory[interior] ? {
            x: memory[interior + 1]!, y: memory[interior + 2]!, depth: memory[interior + 3]!,
          } : null
          pad.weights[i]![1] = memory[offset + 28 + i]!
        }
        pad.contact = memory[offset + 30] ? {
          s: memory[offset + 15]!, t: memory[offset + 16]!,
          x: memory[offset + 17]!, y: memory[offset + 18]!, distance: memory[offset + 19]!,
        } : null
      })
    },
    executeBatch: (pairStart, pairEnd, padStart, padEnd): void => {
      try {
        exports.batch(vertexPointer, segmentPointer, pairPointer, padPointer,
          pairStart, pairEnd, padStart, padEnd,
          Number(geometry.canRejectSeparatedPairs), cursorPointer)
        diagnostics.batches++
      } catch (error) {
        geometry.commitConstraintCursor(memory[cursorOffset]!, memory[cursorOffset + 1]!)
        throw error
      } finally {
        // Also publish every earlier native move when a physical guard throws.
        vertices.forEach((vertex, index): void => {
          const offset = vertexOffset + index * VERTEX_STRIDE
          vertex.x = memory[offset]!
          vertex.y = memory[offset + 1]!
          vertex.revision = memory[offset + 5]!
        })
      }
    },
  }
}
