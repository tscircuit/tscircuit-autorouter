import { expect, test } from "bun:test"
import fixture from "../fixtures/congestion-endpoint-quantization.json"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { restoreHighDensityRouteEndpoints } from "lib/utils/restoreHighDensityRouteEndpoints"

test("restores shared plated-hole endpoints without moving adjusted vias", (): void => {
  const original = fixture.original as HighDensityRoute[]
  const adjusted = fixture.adjusted as HighDensityRoute[]
  const before = structuredClone(adjusted)
  const output = restoreHighDensityRouteEndpoints(original, adjusted)
  for (let i = 0; i < output.length; i++) {
    const route = output[i]
    expect(route.route[0]).toMatchObject({
      x: original[i].route[0].x,
      y: original[i].route[0].y,
      z: original[i].route[0].z,
    })
    expect(route.route.at(-1)).toMatchObject({
      x: original[i].route.at(-1)!.x,
      y: original[i].route.at(-1)!.y,
      z: original[i].route.at(-1)!.z,
    })
    expect(route.vias).toEqual(adjusted[i].vias)
    const innerPoints = route.route.slice(1, -1)
    expect(innerPoints).toEqual(adjusted[i].route)
  }
  expect(adjusted).toEqual(before)
})
