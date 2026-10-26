import { expect, test } from "bun:test"
import { createPhysicalUniformScenario } from "../fixtures/createPhysicalUniformScenario"

test("physical pitch preserves existing port IDs copies links pair order and stable edge order", (): void => {
  const fixture = createPhysicalUniformScenario({
    length: 0.3,
    ports: [
      {
        portPointId: "left",
        connectionName: "a",
        x: 0.1,
        y: 0,
        z: 0,
        nextPortPointId: "right",
      },
      {
        portPointId: "right",
        connectionName: "b",
        x: 0.2,
        y: 0,
        z: 0,
        prevPortPointId: "left",
      },
    ],
  })
  fixture.solver.solve()
  const [first, second] = fixture.solver.getOutput()
  const [a, b] = first!.portPoints
  expect(b!.x - a!.x).toBeGreaterThanOrEqual(0.195 - 1e-12)
  expect(first!.portPoints.map((point) => point.portPointId)).toEqual([
    "left",
    "right",
  ])
  expect(first!.portPoints).toEqual(second!.portPoints)
  expect(
    first!.portPointsInPairs![0]!.map((point) => point.portPointId),
  ).toEqual(["right", "left"])
  expect(first!.portPointsInPairs![0]![0]!.x).toBe(b!.x)
  expect(first!.portPointsInPairs![0]![1]!.x).toBe(a!.x)
  expect(a!.nextPortPointId).toBe("right")
  expect(b!.prevPortPointId).toBe("left")
  expect(fixture.nodes[0]!.portPoints.map((point) => point.x)).toEqual([
    0.1, 0.2,
  ])
})
