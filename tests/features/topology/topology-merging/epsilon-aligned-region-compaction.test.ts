import { expect, test } from "bun:test"
import { compactTopologyMergingRegions } from "lib/solvers/TopologyMergingSolver/topology-merging-regions"
import type { TopologyMergingRegion } from "lib/solvers/TopologyMergingSolver/topology-merging-types"

test("topology compaction rejoins same-source strips aligned within its geometric tolerance", (): void => {
  const metadata = {
    availableZ: [0, 1],
    sourceKeys: ["global:free-region"],
    topologyMode: "passthrough" as const,
    topologySignature: "same-free-region",
  }
  const horizontalRegions: TopologyMergingRegion[] = [
    {
      ...metadata,
      bounds: {
        minX: 57.7500688,
        maxX: 58.0500682,
        minY: 30.472732,
        maxY: 32.3865386,
      },
    },
    {
      ...metadata,
      bounds: {
        minX: 58.0500682,
        maxX: 58.2499408,
        minY: 30.472732,
        maxY: 32.386539,
      },
    },
  ]
  const inputBefore = structuredClone(horizontalRegions)
  const compacted = compactTopologyMergingRegions(horizontalRegions)
  expect(compacted).toHaveLength(1)
  expect(compacted[0]!.bounds).toEqual({
    ...horizontalRegions[0]!.bounds,
    maxX: horizontalRegions[1]!.bounds.maxX,
  })
  expect(compacted[0]!.sourceKeys).toEqual(metadata.sourceKeys)
  expect(compacted[0]!.availableZ).toEqual([0, 1])
  expect(horizontalRegions).toEqual(inputBefore)

  const rotatedRegions = horizontalRegions.map((region) => ({
    ...region,
    bounds: {
      minX: region.bounds.minY,
      maxX: region.bounds.maxY,
      minY: region.bounds.minX,
      maxY: region.bounds.maxX,
    },
  }))
  expect(compactTopologyMergingRegions(rotatedRegions)).toHaveLength(1)

  const distinctBoundaries = structuredClone(horizontalRegions)
  distinctBoundaries[1]!.bounds.maxY += 0.00002
  expect(compactTopologyMergingRegions(distinctBoundaries)).toHaveLength(2)
  const differentSource = structuredClone(horizontalRegions)
  differentSource[1]!.sourceKeys = ["component:other-region"]
  differentSource[1]!.topologySignature = "different-region"
  expect(compactTopologyMergingRegions(differentSource)).toHaveLength(2)
  const differentLayers = structuredClone(horizontalRegions)
  differentLayers[1]!.availableZ = [1]
  expect(compactTopologyMergingRegions(differentLayers)).toHaveLength(2)

  const roundingBoundaryRegions: TopologyMergingRegion[] = [
    {
      ...metadata,
      bounds: {
        minX: 0,
        maxX: 1,
        minY: 1.0000049,
        maxY: 2.0000049,
      },
    },
    {
      ...metadata,
      bounds: {
        minX: 1,
        maxX: 2,
        minY: 1.0000051,
        maxY: 2.0000051,
      },
    },
  ]
  expect(compactTopologyMergingRegions(roundingBoundaryRegions)).toHaveLength(
    1,
  )

  const chainedBoundaries = [0, 0.0000075, 0.000015].map((offset, index) => ({
    ...metadata,
    bounds: {
      minX: index,
      maxX: index + 1,
      minY: offset,
      maxY: 1 + offset,
    },
  }))
  expect(compactTopologyMergingRegions(chainedBoundaries)).toHaveLength(2)

  const unrelatedAnchor = {
    ...chainedBoundaries[0]!,
    sourceKeys: ["component:unrelated-region"],
    topologySignature: "unrelated-region",
  }
  const withoutUnrelatedRegion = compactTopologyMergingRegions(
    chainedBoundaries.slice(1),
  )
  expect(withoutUnrelatedRegion).toHaveLength(1)
  const withUnrelatedRegion = compactTopologyMergingRegions([
    unrelatedAnchor,
    ...chainedBoundaries.slice(1),
  ])
  expect(withUnrelatedRegion).toHaveLength(2)
  expect(
    withUnrelatedRegion.find(
      (region) => region.topologySignature === metadata.topologySignature,
    ),
  ).toEqual(withoutUnrelatedRegion[0])
})
