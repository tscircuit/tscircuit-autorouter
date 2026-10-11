import { expect, test } from "bun:test"
import { TinyTypedAnglePrefixIntersectionIndex } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/TinyTypedAnglePrefixIntersectionIndex"
import type { TinyHyperGraphTopology } from "tiny-hypergraph/lib/core"
import { setNewIntersectionCounts, type MutableIntersectionCount } from "tiny-hypergraph/lib/countNewIntersections"
import type { DynamicAnglePairArrays } from "tiny-hypergraph/lib/types"

type NativeIncidence = {
  first: Int32Array
  second: Int32Array
}

function createTopology(includeSecondAngles: boolean): TinyHyperGraphTopology {
  const incidentPortRegion = [
    [0, 1], [1, 0], [2], [0, 1], [1, 0], [2, 0], [0, 0],
    [0, 1, 2], [2, 1, 0], [0],
  ]
  return {
    portCount: incidentPortRegion.length,
    regionCount: 3,
    incidentPortRegion,
    regionIncidentPorts: [0, 1, 2].map((regionId) => incidentPortRegion.flatMap(
      (regions, portId) => regions.includes(regionId) ? [portId] : [],
    )),
    regionWidth: new Float64Array([2, 3, 4]),
    regionHeight: new Float64Array([4, 3, 2]),
    regionCenterX: new Float64Array(3),
    regionCenterY: new Float64Array(3),
    portAngleForRegion1: new Int32Array([-20, 20, 5, 0, 10, -10, 0, 15, -15, 20]),
    ...(includeSecondAngles ? {
      portAngleForRegion2: new Int32Array([20, -20, 999, 10, 0, 30, 999, -15, 99, 5]),
    } : {}),
    portX: new Float64Array(incidentPortRegion.length),
    portY: new Float64Array(incidentPortRegion.length),
    portZ: new Int32Array([0, 1, 31, -1, 32, 63, 2, 0, 31, 32]),
  }
}

function createNativeIncidence(topology: TinyHyperGraphTopology): NativeIncidence {
  return {
    first: Int32Array.from(topology.incidentPortRegion, (regions) => regions[0] ?? -1),
    second: Int32Array.from(topology.incidentPortRegion, (regions) => regions[1] ?? -1),
  }
}

function nativeAngle(
  topology: TinyHyperGraphTopology,
  incidence: NativeIncidence,
  portId: number,
  regionId: number,
): number {
  return incidence.first[portId] === regionId || incidence.second[portId] !== regionId
    ? topology.portAngleForRegion1[portId]!
    : (topology.portAngleForRegion2?.[portId] ?? topology.portAngleForRegion1[portId])!
}

function createPairs(length: number, seed: number): DynamicAnglePairArrays {
  const pairs = {
    netIds: new Int32Array(length),
    lesserAngles: new Int32Array(length),
    greaterAngles: new Int32Array(length),
    layerMasks: new Int32Array(length),
  }
  const angles = [-2147483648, -20, -15, -10, -1, 0, 5, 10, 15, 20, 30, 2147483647]
  const nets = [7, -7, -2147483648, 2147483647, 0]
  const masks = [0, -1, 1 << 31, 1, 2, 3, 0x55555555, 0xaaaaaaaa]
  for (let index = 0; index < length; index++) {
    const angle1 = angles[(index * 7 + seed) % angles.length]!
    const angle2 = index % 5 === 0 ? angle1 : angles[(index * 5 + seed + 3) % angles.length]!
    pairs.netIds[index] = nets[(index + seed) % nets.length]!
    pairs.lesserAngles[index] = Math.min(angle1, angle2)
    pairs.greaterAngles[index] = Math.max(angle1, angle2)
    pairs.layerMasks[index] = masks[(index + seed) % masks.length]!
  }
  return pairs
}

function assertNativeQuery(
  index: TinyTypedAnglePrefixIntersectionIndex,
  topology: TinyHyperGraphTopology,
  incidence: NativeIncidence,
  pairs: DynamicAnglePairArrays,
  regionId: number,
  port1: number,
  port2: number,
  netId: number,
  z1: number,
  z2: number,
  angleOffset = 0,
): MutableIntersectionCount {
  const angle1 = nativeAngle(topology, incidence, port1, regionId)
  const angle2 = nativeAngle(topology, incidence, port2, regionId)
  const firstIsLesser = angle1 < angle2
  const lesserPort = firstIsLesser ? port1 : port2
  const greaterPort = firstIsLesser ? port2 : port1
  const result: MutableIntersectionCount = {
    netId,
    lesserAngle: (firstIsLesser ? angle1 : angle2) + angleOffset,
    greaterAngle: (firstIsLesser ? angle2 : angle1) - angleOffset,
    layerMask: (1 << z1) | (1 << z2),
    entryExitLayerChanges: z1 !== z2 ? 1 : 0,
    sameLayerIntersectionCount: -101,
    crossingLayerIntersectionCount: -103,
  }
  const expected = { ...result }
  setNewIntersectionCounts(pairs, expected)
  index.setCounts(pairs, result, regionId, lesserPort, greaterPort, z1, z2)
  expect(result).toEqual(expected)
  return result
}

test("typed incidence prefixes preserve native open angles, signed masks, unusual incidence and shared snapshot identity", (): void => {
  for (const includeSecondAngles of [false, true]) {
    const topology = createTopology(includeSecondAngles)
    const incidence = createNativeIncidence(topology)
    const index = new TinyTypedAnglePrefixIntersectionIndex(topology, incidence.first, incidence.second)
    expect(index.collectDiagnostics).toBe(false)
    index.collectDiagnostics = true
    const savedTopology = structuredClone(topology)
    const snapshots: DynamicAnglePairArrays[] = []
    for (const length of [0, 1, 7, 8, 16, 31, 32, 33]) {
      for (const seed of [0, 3]) {
        const pairs = createPairs(length, seed)
        const saved = structuredClone(pairs)
        snapshots.push(pairs)
        // The same immutable snapshot is deliberately installed in all regions.
        for (const regionId of [0, 1, 2]) {
          for (let port1 = 0; port1 < topology.portCount; port1++) {
            for (let port2 = 0; port2 < topology.portCount; port2++) {
              for (const netId of [7, -2147483648, 2147483648, 7.5]) {
                const z1 = topology.portZ[port1]!
                const z2 = topology.portZ[port2]!
                assertNativeQuery(index, topology, incidence, pairs, regionId, port1, port2, netId, z1, z2)
              }
            }
          }
        }
        expect(pairs).toEqual(saved)
      }
    }
    // Restore older objects after later snapshots populated every region cache.
    for (const pairs of snapshots.toReversed()) {
      for (const regionId of [0, 1, 2]) {
        for (const [z1, z2] of [[-1, 31], [0, 32], [31, 63], [31, 0], [0, 0]]) {
          assertNativeQuery(index, topology, incidence, pairs, regionId, 0, 1, -7, z1!, z2!)
        }
        // A synthetic query angle must fall back to the native loop.
        assertNativeQuery(index, topology, incidence, pairs, regionId, 0, 1, -7, 0, 31, 1)
      }
    }
    expect(index.diagnostics.indexedCalls).toBeGreaterThan(0)
    expect(index.diagnostics.nativeCalls).toBeGreaterThan(0)
    expect(index.diagnostics.snapshotBuilds).toBeGreaterThan(0)
    expect(topology).toEqual(savedTopology)

    const highBit = {
      netIds: new Int32Array(32).fill(11),
      lesserAngles: new Int32Array(32).fill(-30),
      greaterAngles: new Int32Array(32).fill(30),
      layerMasks: new Int32Array(32).fill(1),
    }
    highBit.lesserAngles[31] = 0
    highBit.layerMasks[31] = 1 << 31
    const entered = assertNativeQuery(index, topology, incidence, highBit, 0, 0, 9, 12, 31, 31)
    expect([entered.sameLayerIntersectionCount, entered.crossingLayerIntersectionCount]).toEqual([1, 0])
    const sameNet = assertNativeQuery(index, topology, incidence, highBit, 0, 0, 9, 11, 31, 31)
    expect([sameNet.sameLayerIntersectionCount, sameNet.crossingLayerIntersectionCount]).toEqual([0, 0])
    // Both original entry/exit Z values are retained despite identical shift bits.
    const aliasedLayers = assertNativeQuery(index, topology, incidence, highBit, 0, 0, 9, 12, -1, 63)
    expect(aliasedLayers.entryExitLayerChanges).toBe(1)
    for (const layerMask of [0, -1, 1 << 31]) {
      const result: MutableIntersectionCount = {
        netId: 12, lesserAngle: -20, greaterAngle: 20, layerMask,
        entryExitLayerChanges: 3, sameLayerIntersectionCount: -1, crossingLayerIntersectionCount: -1,
      }
      const expected = { ...result }
      setNewIntersectionCounts(highBit, expected)
      // Custom public masks need native fallback instead of endpoint-Z masks.
      index.setCounts(highBit, result, 0, 0, 9, 0, 0)
      expect(result).toEqual(expected)
    }

    const mismatchedArrays: DynamicAnglePairArrays = {
      ...highBit,
      greaterAngles: highBit.greaterAngles.slice(0, 31),
      layerMasks: highBit.layerMasks.slice(0, 31),
    }
    assertNativeQuery(index, topology, incidence, mismatchedArrays, 0, 0, 9, 12, 31, 31)
  }

  const shortAngles = createTopology(false)
  shortAngles.portAngleForRegion1 = shortAngles.portAngleForRegion1.slice(0, 4)
  const shortIncidence = createNativeIncidence(shortAngles)
  const shortIndex = new TinyTypedAnglePrefixIntersectionIndex(shortAngles, shortIncidence.first, shortIncidence.second)
  const pairs = createPairs(32, 0)
  for (const regionId of [0, 1, 2]) {
    for (const [port1, port2] of [[0, 9], [6, 7], [-1, 0], [0, 99]]) {
      assertNativeQuery(shortIndex, shortAngles, shortIncidence, pairs, regionId, port1!, port2!, 7, 0, 31)
    }
  }

  let seed = 0x492fae17
  const randomInt32 = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed | 0
  }
  const restored: Array<{
    index: TinyTypedAnglePrefixIntersectionIndex
    topology: TinyHyperGraphTopology
    incidence: NativeIncidence
    pairs: DynamicAnglePairArrays
    net: number
  }> = []
  for (let snapshotNumber = 0; snapshotNumber < 100; snapshotNumber++) {
    const topology = createTopology(snapshotNumber % 3 !== 0)
    const incidence = createNativeIncidence(topology)
    for (let portId = 0; portId < topology.portCount; portId++) {
      topology.portAngleForRegion1[portId] = randomInt32()
      if (topology.portAngleForRegion2) topology.portAngleForRegion2[portId] = randomInt32()
      topology.portZ[portId] = randomInt32()
    }
    const index = new TinyTypedAnglePrefixIntersectionIndex(topology, incidence.first, incidence.second)
    index.collectDiagnostics = true
    const pairs = createPairs(8 + (randomInt32() >>> 0) % 25, 0)
    for (let segment = 0; segment < pairs.netIds.length; segment++) {
      const angle1 = randomInt32()
      const angle2 = segment % 7 === 0 ? angle1 : randomInt32()
      pairs.lesserAngles[segment] = Math.min(angle1, angle2)
      pairs.greaterAngles[segment] = Math.max(angle1, angle2)
      pairs.netIds[segment] = randomInt32()
      pairs.layerMasks[segment] = randomInt32()
    }
    const savedPairs = structuredClone(pairs)
    const savedTopology = structuredClone(topology)
    const queryNet = randomInt32()
    for (const regionId of [0, 1, 2]) {
      const ports = topology.regionIncidentPorts[regionId]!
      for (const port1 of ports) {
        for (const port2 of ports) {
          for (const net of [queryNet, pairs.netIds[(port1 + port2) % pairs.netIds.length]!]) {
            assertNativeQuery(index, topology, incidence, pairs, regionId, port1, port2,
              net, topology.portZ[port1]!, topology.portZ[port2]!)
          }
        }
      }
    }
    // Replace the occupancy snapshot, then later restore this original object.
    const replacement: DynamicAnglePairArrays = {
      netIds: pairs.netIds.slice(), lesserAngles: pairs.lesserAngles.slice(),
      greaterAngles: pairs.greaterAngles.slice(), layerMasks: pairs.layerMasks.slice(),
    }
    replacement.layerMasks[0] = randomInt32()
    replacement.netIds[0] = queryNet
    assertNativeQuery(index, topology, incidence, replacement, 0, 0, 9, queryNet, -1, 63)
    expect(index.diagnostics.indexedCalls).toBeGreaterThan(0)
    expect(pairs).toEqual(savedPairs)
    expect(topology).toEqual(savedTopology)
    if (snapshotNumber % 10 === 0) restored.push({ index, topology, incidence, pairs, net: queryNet })
  }
  for (const { index, topology, incidence, pairs, net } of restored.toReversed()) {
    for (const regionId of [0, 1, 2]) {
      const ports = topology.regionIncidentPorts[regionId]!
      for (const port1 of ports) {
        for (const port2 of ports) {
          assertNativeQuery(index, topology, incidence, pairs, regionId, port1, port2,
            net, topology.portZ[port1]!, topology.portZ[port2]!)
        }
      }
    }
  }
})
