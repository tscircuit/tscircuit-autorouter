import { expect, test } from "bun:test"
import { getRoutedDifferentialPairSegments } from "lib/utils/getRoutedDifferentialPairSegments"

test("orders reversed chains and shares the declared length and uncoupled budgets", () => {
  const pairs = getRoutedDifferentialPairSegments({
    differentialPairs: [
      {
        connectionNames: ["p", "n"],
        lengthTolerance: 0.2,
        maxUncoupledLength: 2,
        traceGap: 0.1,
      },
    ],
    connections: [
      {
        name: "a",
        __rootConnectionNames: ["p"],
        pointsToConnect: [
          { x: 0, y: 1, layer: "top" },
          { x: 2, y: 1, layer: "top" },
        ],
      },
      {
        name: "b",
        __rootConnectionNames: ["p"],
        pointsToConnect: [
          { x: 2, y: 1, layer: "top" },
          { x: 4, y: 1, layer: "top" },
        ],
      },
      {
        name: "c",
        __rootConnectionNames: ["n"],
        pointsToConnect: [
          { x: 4, y: -1, layer: "top" },
          { x: 2, y: -1, layer: "top" },
        ],
      },
      {
        name: "d",
        __rootConnectionNames: ["n"],
        pointsToConnect: [
          { x: 2, y: -1, layer: "top" },
          { x: 0, y: -1, layer: "top" },
        ],
      },
    ],
    hdRoutes: ["a", "b", "c", "d"].map((connectionName) => ({
      connectionName,
      traceThickness: 0.2,
      viaDiameter: 0.3,
      route: [],
      vias: [],
    })),
  })
  expect(pairs).toEqual([
    {
      connectionNames: ["a", "d"],
      lengthTolerance: 0.1,
      maxUncoupledLength: 1,
      minimumCenterlineDistance: 0.30000000000000004,
      maximumCenterlineDistance: 0.30000000000000004,
    },
    {
      connectionNames: ["b", "c"],
      lengthTolerance: 0.1,
      maxUncoupledLength: 1,
      minimumCenterlineDistance: 0.30000000000000004,
      maximumCenterlineDistance: 0.30000000000000004,
    },
  ])
})
