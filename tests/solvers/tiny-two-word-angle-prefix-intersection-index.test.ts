import { expect, test } from "bun:test"
import { TinyTypedAnglePrefixIntersectionIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyTypedAnglePrefixIntersectionIndex"
import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { setNewIntersectionCounts, type MutableIntersectionCount } from "tiny-hypergraph/lib/countNewIntersections"
import type { DynamicAnglePairArrays } from "tiny-hypergraph/lib/types"

type RestoredSnapshot = {
  index: TinyTypedAnglePrefixIntersectionIndex
  pairs: DynamicAnglePairArrays
  topology: TinyHyperGraphTopology
}

function createTopology(portCount: number): TinyHyperGraphTopology {
  const incidentPortRegion = Array.from({ length: portCount }, (_, port) =>
    port % 2 === 0 ? [0, 1] : [1, 0])
  return {
    portCount, regionCount: 2, incidentPortRegion,
    regionIncidentPorts: [Array.from({ length: portCount }, (_, port) => port),
      Array.from({ length: portCount }, (_, port) => port)],
    portAngleForRegion1: Int32Array.from({ length: portCount }, (_, port) => (port - 16) * 2),
    portAngleForRegion2: Int32Array.from({ length: portCount }, (_, port) => (port - 16) * 2 + (port % 3)),
    portX: new Float64Array(portCount), portY: new Float64Array(portCount),
    portZ: Int32Array.from({ length: portCount }, (_, port) => port % 4 === 0 ? 31 : port % 3),
    regionWidth: new Float64Array([1, 1]), regionHeight: new Float64Array([1, 1]),
    regionCenterX: new Float64Array(2), regionCenterY: new Float64Array(2),
  }
}

function createIndex(topology: TinyHyperGraphTopology): TinyTypedAnglePrefixIntersectionIndex {
  const first = Int32Array.from(topology.incidentPortRegion, (regions) => regions[0]!)
  const second = Int32Array.from(topology.incidentPortRegion, (regions) => regions[1]!)
  const index = new TinyTypedAnglePrefixIntersectionIndex(topology, first, second)
  index.collectDiagnostics = true
  expect(index.diagnostics).toEqual({ snapshotBuilds: 0, indexedCalls: 0, nativeCalls: 0 })
  return index
}

function assertQuery(
  index: TinyTypedAnglePrefixIntersectionIndex, topology: TinyHyperGraphTopology,
  pairs: DynamicAnglePairArrays, region: number, from: number, to: number,
  net: number, z1: number, z2: number,
): MutableIntersectionCount {
  const firstFrom = topology.incidentPortRegion[from]![0] === region
  const firstTo = topology.incidentPortRegion[to]![0] === region
  const fromAngle = firstFrom ? topology.portAngleForRegion1[from]! : topology.portAngleForRegion2![from]!
  const toAngle = firstTo ? topology.portAngleForRegion1[to]! : topology.portAngleForRegion2![to]!
  const fromIsLesser = fromAngle < toAngle
  const result: MutableIntersectionCount = {
    netId: net, lesserAngle: fromIsLesser ? fromAngle : toAngle,
    greaterAngle: fromIsLesser ? toAngle : fromAngle, layerMask: (1 << z1) | (1 << z2),
    entryExitLayerChanges: z1 !== z2 ? 1 : 0,
    sameLayerIntersectionCount: -11, crossingLayerIntersectionCount: -13,
  }
  const expected = { ...result }
  setNewIntersectionCounts(pairs, expected)
  index.setCounts(pairs, result, region, fromIsLesser ? from : to, fromIsLesser ? to : from, z1, z2)
  if (result.sameLayerIntersectionCount !== expected.sameLayerIntersectionCount ||
    result.crossingLayerIntersectionCount !== expected.crossingLayerIntersectionCount ||
    result.entryExitLayerChanges !== expected.entryExitLayerChanges) {
    throw new Error(`Two-word oracle mismatch at ${pairs.netIds.length} segments, region ${region}, ports ${from}/${to}, net ${net}, layers ${z1}/${z2}`)
  }
  return result
}

test("two-word prefixes preserve 3.4 million native queries, immutable restore, signed boundaries and explicit storage eligibility", (): void => {
  let seed = 0x1a690e37
  const randomInt32 = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed | 0
  }
  const layerPairs = [[0, 0], [1, 1], [31, 31], [-1, 63], [0, 32], [1, 33],
    [0, 31], [31, 0], [-33, 94], [2, 7], [15, 16], [31, 32], [-2147483648, 2147483647]]
  const restored: RestoredSnapshot[] = []
  let oracleQueries = 0
  for (let snapshotNumber = 0; snapshotNumber < 64; snapshotNumber++) {
    const topology = createTopology(32)
    for (let port = 0; port < topology.portCount; port++) {
      topology.portAngleForRegion1[port] = snapshotNumber % 4 === 0 ? randomInt32() : (port - 16) * 2
      topology.portAngleForRegion2![port] = snapshotNumber % 4 === 1 ? randomInt32() : (port - 16) * 2 + (port % 3)
    }
    const index = createIndex(topology)
    const count = 33 + snapshotNumber % 32
    const pairs: DynamicAnglePairArrays = {
      netIds: new Int32Array(count), lesserAngles: new Int32Array(count),
      greaterAngles: new Int32Array(count), layerMasks: new Int32Array(count),
    }
    for (let segment = 0; segment < count; segment++) {
      const endpoint1 = segment % 3 === 0 ? randomInt32() : (randomInt32() % 33) * 2
      const endpoint2 = segment % 5 === 0 ? endpoint1 : (randomInt32() % 33) * 2
      // Native counts also accept inverted stored pairs; the endpoint XOR must retain them.
      pairs.lesserAngles[segment] = segment % 7 === 0 ? Math.max(endpoint1, endpoint2) : Math.min(endpoint1, endpoint2)
      pairs.greaterAngles[segment] = segment % 7 === 0 ? Math.min(endpoint1, endpoint2) : Math.max(endpoint1, endpoint2)
      pairs.netIds[segment] = segment % 4 === 0 ? -2147483648 : segment % 4 === 1 ? 0 : randomInt32()
      pairs.layerMasks[segment] = randomInt32()
    }
    const savedPairs = structuredClone(pairs)
    const savedTopology = structuredClone(topology)
    const region = snapshotNumber % 2
    for (let from = 0; from < 32; from++) {
      for (let to = 0; to < 32; to++) {
        for (const net of [pairs.netIds[(from + to) % count]!, 2147483648, Number.NaN, 0.5]) {
          for (const [z1, z2] of layerPairs) {
            assertQuery(index, topology, pairs, region, from, to, net, z1!, z2!)
            oracleQueries++
          }
        }
      }
    }
    const replacement: DynamicAnglePairArrays = {
      netIds: pairs.netIds.slice(), lesserAngles: pairs.lesserAngles.slice(),
      greaterAngles: pairs.greaterAngles.slice(), layerMasks: pairs.layerMasks.slice(),
    }
    replacement.netIds[32] = 123
    replacement.layerMasks[32] ^= -1
    assertQuery(index, topology, replacement, region, 0, 31, 123, 31, 0)
    // A cache object may be shared between regions, which need different incidence rows.
    assertQuery(index, topology, pairs, 1 - region, 0, 31, -2147483648, -1, 63)
    expect(index.diagnostics.indexedCalls).toBeGreaterThan(0)
    expect(index.diagnostics.nativeCalls).toBe(0)
    expect(pairs).toEqual(savedPairs)
    expect(topology).toEqual(savedTopology)
    restored.push({ index, pairs, topology })
  }
  expect(oracleQueries).toBe(3_407_872)
  for (const { index, pairs, topology } of restored.toReversed()) {
    for (const region of [0, 1]) {
      assertQuery(index, topology, pairs, region, 0, 31, -0, -1, 63)
      assertQuery(index, topology, pairs, region, 31, 0, pairs.netIds[31]!, 0, 31)
    }
  }

  const topology = createTopology(32)
  const index = createIndex(topology)
  const boundaryPairs: DynamicAnglePairArrays = {
    netIds: new Int32Array(64).fill(37), lesserAngles: new Int32Array(64).fill(-100),
    greaterAngles: new Int32Array(64).fill(100), layerMasks: new Int32Array(64).fill(0),
  }
  for (const segment of [31, 32, 63]) {
    boundaryPairs.lesserAngles[segment] = 0
    boundaryPairs.layerMasks[segment] = segment === 32 ? 1 : 1 << 31
  }
  const entered = assertQuery(index, topology, boundaryPairs, 0, 0, 31, 38, 31, 31)
  expect([entered.sameLayerIntersectionCount, entered.crossingLayerIntersectionCount]).toEqual([2, 1])
  const sameNet = assertQuery(index, topology, boundaryPairs, 0, 0, 31, 37, -1, 63)
  expect([sameNet.sameLayerIntersectionCount, sameNet.crossingLayerIntersectionCount, sameNet.entryExitLayerChanges]).toEqual([0, 0, 1])
  for (const portCount of [4048, 4049]) {
    const largeTopology = createTopology(portCount)
    const largeIndex = createIndex(largeTopology)
    assertQuery(largeIndex, largeTopology, boundaryPairs, 0, 0, portCount - 1, 38, 0, 31)
    expect(largeIndex.diagnostics.indexedCalls).toBe(portCount === 4048 ? 1 : 0)
    expect(largeIndex.diagnostics.nativeCalls).toBe(portCount === 4048 ? 0 : 1)
  }
  const oversizedPairs: DynamicAnglePairArrays = {
    netIds: new Int32Array(65).fill(37), lesserAngles: new Int32Array(65).fill(0),
    greaterAngles: new Int32Array(65).fill(100), layerMasks: new Int32Array(65).fill(1 << 31),
  }
  const unsupportedPairs = [oversizedPairs, { ...boundaryPairs, greaterAngles: boundaryPairs.greaterAngles.slice(0, 63) }]
  for (const pairs of unsupportedPairs) {
    const nativeCalls = index.diagnostics.nativeCalls
    assertQuery(index, topology, pairs, 0, 0, 31, 38, -1, 63)
    expect(index.diagnostics.nativeCalls).toBe(nativeCalls + 1)
  }
  for (const [lesserAngle, greaterAngle, layerMask] of [[-Infinity, Infinity, 1 << 31],
    [Number.NaN, 100, -1], [-10, 10, -1], [100, -100, 0]]) {
    const result: MutableIntersectionCount = {
      netId: 38, lesserAngle: lesserAngle!, greaterAngle: greaterAngle!, layerMask: layerMask!,
      entryExitLayerChanges: 7, sameLayerIntersectionCount: -11, crossingLayerIntersectionCount: -13,
    }
    const expected = { ...result }
    setNewIntersectionCounts(boundaryPairs, expected)
    const nativeCalls = index.diagnostics.nativeCalls
    index.setCounts(boundaryPairs, result, 0, 0, 31, 31, 31)
    expect(result).toEqual(expected)
    expect(index.diagnostics.nativeCalls).toBe(nativeCalls + 1)
  }
})
