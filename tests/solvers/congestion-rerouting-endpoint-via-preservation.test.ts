import { expect, test } from "bun:test"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { restoreHighDensityRouteEndpoints } from "lib/utils/restoreHighDensityRouteEndpoints"

test("endpoint connectors retain a via at the adjusted endpoint and reject layer changes", (): void => {
  const original: HighDensityRoute = { connectionName: "net", regionId: "box", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0.00049, y: 0, z: 0 }, { x: 0.00049, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0.00049, y: 0 }] }
  const adjusted: HighDensityRoute = { ...original, route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] }
  const output = restoreHighDensityRouteEndpoints([original], [adjusted])[0]
  expect(output.route).toEqual([{ x: 0.00049, y: 0, z: 0 }, ...adjusted.route])
  expect(output.vias).toEqual([{ x: 0, y: 0 }])
  const invalid = structuredClone(adjusted)
  invalid.route[0].z = 1
  expect(() => restoreHighDensityRouteEndpoints([original], [invalid])).toThrow()
  expect(() => restoreHighDensityRouteEndpoints([original], [])).toThrow()
})
