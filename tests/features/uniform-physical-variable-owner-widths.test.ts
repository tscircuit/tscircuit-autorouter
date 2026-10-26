import { expect, test } from "bun:test"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("a narrow same-owner port cannot hide an earlier wide trace from a foreign port", (): void => {
  const fixture = createPhysicalUniformScenario({
    length: 0.3,
    ports: [
      {
        portPointId: "wide",
        connectionName: "wide",
        rootConnectionName: "a",
        x: 0.05,
        y: 0,
        z: 0,
      },
      {
        portPointId: "narrow",
        connectionName: "narrow",
        rootConnectionName: "a",
        x: 0.1,
        y: 0,
        z: 0,
      },
      { portPointId: "foreign", connectionName: "b", x: 0.2, y: 0, z: 0 },
    ],
    rules: {
      connections: [
        {
          name: "wide",
          nominalTraceWidth: 0.5,
          __rootConnectionNames: ["a"],
          pointsToConnect: [],
        },
        {
          name: "narrow",
          nominalTraceWidth: 0.1,
          __rootConnectionNames: ["a"],
          pointsToConnect: [],
        },
        { name: "b", pointsToConnect: [] },
      ],
    },
  })
  expect(() => fixture.solver.solve()).toThrow(
    "No owner-clear ordered placement",
  )
})
