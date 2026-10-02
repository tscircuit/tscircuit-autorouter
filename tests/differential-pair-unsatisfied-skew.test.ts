import { expect, test } from "bun:test"
import { assertDifferentialPairLengthSkew } from "lib/utils/assertDifferentialPairLengthSkew"

test("rejects unequal returned routes instead of accepting a completed solve", () => {
  expect(() =>
    assertDifferentialPairLengthSkew({
      differentialPairs: [
        { connectionNames: ["a", "b"], lengthTolerance: 0.1 },
      ],
      hdRoutes: [
        {
          connectionName: "a",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          vias: [],
          route: [
            { x: 0, y: 1, z: 0 },
            { x: 2, y: 1, z: 0 },
          ],
        },
        {
          connectionName: "b",
          traceThickness: 0.15,
          viaDiameter: 0.3,
          vias: [],
          route: [
            { x: 0, y: -1, z: 0 },
            { x: 1, y: -1, z: 0 },
          ],
        },
      ],
    }),
  ).toThrow("routed skew 1mm exceeds 0.1mm")
})
