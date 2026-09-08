import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("every shared-port owner and pair copy must agree on physical coordinates and net", (): void => {
  const violations = [
    "owner-x",
    "owner-y",
    "owner-z",
    "owner-net",
    "third-owner",
    "input-owner-pair",
    "pair-x",
    "pair-y",
    "pair-z",
    "pair-net",
    "pair-unknown-name",
  ] as const
  for (const violation of violations) {
    const input = createUniformPhysicalClearanceInput({
      orientation: "horizontal",
      axisStart: 10,
      axisEnd: 14,
      sharedCoordinate: 20,
      portPoints: [
        {
          portPointId: "shared-port",
          connectionName: "route",
          x: 10.5,
          y: 20,
          z: 0,
        },
      ],
      rectangles: [],
      canonicalNetIdByConnectionName: new Map([
        ["route", "route-net"],
        ["other-route", "other-net"],
      ]),
      traceWidth: 0.5,
      traceToPadClearance: 0.25,
      traceToTraceClearance: 0.25,
    })
    const laterOwner = input.nodeWithPortPoints[1]
    const laterPoint = laterOwner.portPoints[0]
    const pairPoint = { ...laterPoint }
    laterOwner.portPointsInPairs = [
      [pairPoint, { ...laterPoint, portPointId: undefined, x: 12, y: 20.5 }],
    ]
    if (violation === "owner-x") laterPoint.x += 0.125
    if (violation === "owner-y") laterPoint.y += 0.125
    if (violation === "owner-z") laterPoint.z = 1
    if (violation === "owner-net") laterPoint.connectionName = "other-route"
    if (violation === "third-owner") {
      laterOwner.capacityMeshNodeId = "third-owner"
    }
    if (violation === "input-owner-pair") {
      input.inputNodesWithPortPoints[1].portPoints[0].connectionNodeIds = [
        "first-owner",
        "third-owner",
      ]
    }
    if (violation === "pair-x") pairPoint.x += 0.125
    if (violation === "pair-y") pairPoint.y += 0.125
    if (violation === "pair-z") pairPoint.z = 1
    if (violation === "pair-net") pairPoint.connectionName = "other-route"
    if (violation === "pair-unknown-name") pairPoint.connectionName = "unknown"
    const originalNodes = structuredClone(input.nodeWithPortPoints)
    expect((): void => {
      const solver = new UniformPortDistributionSolver(input)
      solver.solve()
      expect(solver.solved).toBe(false)
      expect(solver.getOutput()).toHaveLength(0)
      expect(input.nodeWithPortPoints).toEqual(originalNodes)
    }).toThrow(/Uniform (?:input |pair )?port "shared-port"/)
    expect(input.nodeWithPortPoints).toEqual(originalNodes)
  }
})
