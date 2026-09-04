import { expect, test } from "bun:test"
import { compactTopologyMergingRegions } from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import type { TopologyMergingRegion } from "lib/solvers/TopologyMergingSolver/topology-merging-types"

test("compaction preserves interleaved topology order when no regions merge", (): void => {
  const regions: TopologyMergingRegion[] = ["first", "second", "first"].map(
    (sourceKey, index): TopologyMergingRegion => ({
      bounds: {
        minX: index * 2,
        maxX: index * 2 + 1,
        minY: index * 2,
        maxY: index * 2 + 1,
      },
      availableZ: [0, 1],
      sourceKeys: [sourceKey],
      topologyMode: "passthrough",
      topologySignature: sourceKey,
    }),
  )

  expect(compactTopologyMergingRegions(regions)).toEqual(regions)
})
