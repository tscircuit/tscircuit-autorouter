import { expect, test } from "bun:test"
import { getSegmentBucketCoordinates } from "lib/data-structures/HighDensityRouteSpatialIndex"

test("diagonal segments index only the grid cells they cross", () => {
  const bucketCoordinates = getSegmentBucketCoordinates(
    [
      { x: 0.5, y: 0.5, z: 0 },
      { x: 100.5, y: 100.5, z: 0 },
    ],
    1,
  )

  expect(bucketCoordinates).toHaveLength(301)
  expect(bucketCoordinates).toContain("50x50")
  expect(bucketCoordinates).not.toContain("0x100")

  const shallowSegmentBuckets = getSegmentBucketCoordinates(
    [
      { x: 0.5, y: 0.5, z: 0 },
      { x: 100.5, y: 1.5, z: 0 },
    ],
    1,
  )
  expect(shallowSegmentBuckets.length).toBeLessThan(200)
  expect(shallowSegmentBuckets).toContain("100x1")
})
