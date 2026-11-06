import { expect, test } from "bun:test"
import { getHorizontalMergeBucketKey } from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import type {
  HorizontalTopologyMergingBucketKey,
  TopologyMergingRegion,
} from "lib/solvers/TopologyMergingSolver/topology-merging-types"

type LegacyHorizontalBucketKey = string

test("keeps bucket identity through encoding and rounding", (): void => {
  const oldToNew = new Map<
    LegacyHorizontalBucketKey,
    HorizontalTopologyMergingBucketKey
  >()
  const newToOld = new Map<
    HorizontalTopologyMergingBucketKey,
    LegacyHorizontalBucketKey
  >()
  const signatures = [
    "free:0",
    "free:1",
    JSON.stringify({ mode: "passthrough", sourceKeys: ["a,b", "c"] }),
    JSON.stringify({ mode: "passthrough", sourceKeys: ["a", "b,c"] }),
    JSON.stringify({ mode: "merged", sourceKeys: ['a"b\\c\nd', "\u0000"] }),
    JSON.stringify({ mode: "merged", sourceKeys: ['a"b\\c\nd', "\\u0000"] }),
  ]
  const starts = [-0, 0, -1e-9, 1e-9, 1, 1 + 1e-15, 1 + 1e-12, 1e9]
  const layerSets = [[0], [1], [0, 1], [1, 23], [12, 13]]
  for (const topologySignature of signatures) {
    for (const availableZ of layerSets) {
      for (const minY of starts) {
        for (const minX of [0, 2]) {
          const region: TopologyMergingRegion = {
            bounds: { minX, maxX: minX + 1, minY, maxY: minY + 1 },
            availableZ,
            topologySignature,
            topologyMode: "passthrough",
            sourceKeys: ["source"],
          }
          const originalKey = JSON.stringify({
            mergeKey: JSON.stringify({ availableZ, topologySignature }),
            minY: region.bounds.minY.toPrecision(15),
            maxY: region.bounds.maxY.toPrecision(15),
          })
          const actualKey = getHorizontalMergeBucketKey(region)
          if (oldToNew.has(originalKey)) {
            expect(actualKey).toBe(oldToNew.get(originalKey)!)
          } else {
            oldToNew.set(originalKey, actualKey)
          }
          if (newToOld.has(actualKey)) {
            expect(originalKey).toBe(newToOld.get(actualKey)!)
          } else {
            newToOld.set(actualKey, originalKey)
          }
        }
      }
    }
  }
  expect(oldToNew.size).toBe(180)
  expect(newToOld.size).toBe(oldToNew.size)
})
