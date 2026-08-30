import { expect, test } from "bun:test"
import { getRegionAreaRatio } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/RegionalDrcRerouteSolver"
import type { RerouteRectRegion } from "lib/utils/getRerouteSimpleRouteJson"

const sixMillimeterRegion: RerouteRectRegion = {
  shape: "rect",
  minX: -3,
  maxX: 3,
  minY: -3,
  maxY: 3,
}

test("regional reroute area ratio distinguishes board-wide work from local repair", (): void => {
  const srj19Sample133Ratio: number = getRegionAreaRatio(sixMillimeterRegion, {
    minX: -10.025,
    maxX: 10.025,
    minY: -10.025,
    maxY: 10.025,
  })
  const bug94Ratio: number = getRegionAreaRatio(sixMillimeterRegion, {
    minX: -68.175,
    maxX: 68.175,
    minY: -47.685232,
    maxY: 47.685232,
  })

  expect(srj19Sample133Ratio).toBeGreaterThan(0.05)
  expect(bug94Ratio).toBeLessThan(0.05)
})
