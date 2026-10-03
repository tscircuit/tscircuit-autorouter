import { FlatbushIndex } from "lib/data-structures/FlatbushIndex"
import type { ConnectionPoint } from "lib/types"
import {
  CONNECTION_POINT_REGION_TOLERANCE,
  checkIfConnectionPointIsInRegion,
} from "./checkIfConnectionPointIsInRegion"
import type { RegionHg } from "./types"

/**
 * Static spatial index for resolving connection endpoints to capacity regions.
 * Results preserve the original region order used by the linear scan.
 */
export class ConnectionPointRegionIndex {
  private readonly index?: FlatbushIndex<RegionHg>
  private readonly regionIndex = new Map<RegionHg, number>()

  constructor(
    regions: RegionHg[],
    private readonly layerCount: number,
  ) {
    if (regions.length === 0) return

    this.index = new FlatbushIndex<RegionHg>(regions.length)

    for (const [index, region] of regions.entries()) {
      this.regionIndex.set(region, index)
      const halfWidth = region.d.width / 2
      const halfHeight = region.d.height / 2
      this.index.insert(
        region,
        region.d.center.x - halfWidth - CONNECTION_POINT_REGION_TOLERANCE,
        region.d.center.y - halfHeight - CONNECTION_POINT_REGION_TOLERANCE,
        region.d.center.x + halfWidth + CONNECTION_POINT_REGION_TOLERANCE,
        region.d.center.y + halfHeight + CONNECTION_POINT_REGION_TOLERANCE,
      )
    }

    this.index.finish()
  }

  getRegionsContainingPoint(point: ConnectionPoint): RegionHg[] {
    if (!this.index) return []

    return this.index
      .search(point.x, point.y, point.x, point.y)
      .filter((region) =>
        checkIfConnectionPointIsInRegion({
          point,
          region,
          layerCount: this.layerCount,
        }),
      )
      .sort(
        (regionA, regionB) =>
          this.regionIndex.get(regionA)! - this.regionIndex.get(regionB)!,
      )
  }
}
