import { expect, test } from "bun:test"
import { getRoutedDifferentialPairSegments } from "lib/utils/getRoutedDifferentialPairSegments"

test("rejects a branched differential pair member", () => {
  expect(() =>
    getRoutedDifferentialPairSegments({
      differentialPairs: [
        { connectionNames: ["positive", "negative"], lengthTolerance: 0.1 },
      ],
      connections: [
        {
          name: "a",
          __rootConnectionNames: ["positive"],
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: -2, y: 0, layer: "top" },
          ],
        },
        {
          name: "b",
          __rootConnectionNames: ["positive"],
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 2, y: 0, layer: "top" },
          ],
        },
        {
          name: "c",
          __rootConnectionNames: ["positive"],
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 0, y: 2, layer: "top" },
          ],
        },
      ],
      hdRoutes: [],
    }),
  ).toThrow("Differential pair member must form one unbranched path")
})
