import { expect, test } from "bun:test"
import { createOwnerCutFixedCopperOracle } from "lib/solvers/HighDensitySolver/createOwnerCutFixedCopperOracle"
import { validateOwnerCutRoutes } from "lib/solvers/HighDensitySolver/validateOwnerCutRoutes"
import { ownerCutParams } from "./ownerCutTestUtils"

test("dedicated via-to-pad clearance constrains frozen moves and physical acceptance", (): void => {
  const params = { ...ownerCutParams(), traceThickness: 0.1, traceMargin: 0.1 }
  params.nodeWithPortPoints.portPoints = []
  params.obstacles = [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2,
    height: 0.2, layers: ["top", "bottom"], connectedTo: [] }]
  const route = { connectionName: "via", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: 0.6, y: 0, z: 0 }, { x: 0.6, y: 0, z: 1 }],
    vias: [{ x: 0.6, y: 0 }] }
  expect(createOwnerCutFixedCopperOracle(params)(route, (): boolean => true)).toBe(false)
  expect(validateOwnerCutRoutes([route], params)).toBeUndefined()
  const strict = { ...params, viaToPadClearance: 0.4 }
  expect(createOwnerCutFixedCopperOracle(strict)(route, (): boolean => true)).toBe(true)
  expect(validateOwnerCutRoutes([route], strict)).toBeDefined()
})
