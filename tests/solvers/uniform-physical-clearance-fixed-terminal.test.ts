import { expect, test } from "bun:test"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import { createUniformPhysicalClearanceInput } from "./fixtures/createUniformPhysicalClearanceInput"

test("target terminals and exact singleton clearance channels remain fixed", (): void => {
  const terminalInput = createUniformPhysicalClearanceInput({
    orientation: "horizontal",
    axisStart: 10,
    axisEnd: 14,
    sharedCoordinate: 20,
    portPoints: [
      {
        portPointId: "fixed-terminal",
        pcb_port_id: "terminal-pad-port",
        connectionName: "terminal-route",
        x: 10.75,
        y: 20,
        z: 0,
      },
    ],
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 10.75, y: 20 },
        width: 0.5,
        height: 0.5,
        zLayers: [0],
        ownerNetIds: new Set(["terminal-net"]),
      },
      {
        kind: "fixed-rectangle",
        center: { x: 13.75, y: 20 },
        width: 0.5,
        height: 0.5,
        zLayers: [0],
        ownerNetIds: new Set(["foreign-pad-net"]),
      },
    ],
    canonicalNetIdByConnectionName: new Map([
      ["terminal-route", "terminal-net"],
    ]),
    traceWidth: 0.5,
    traceToPadClearance: 0.25,
    traceToTraceClearance: 0.25,
  })
  terminalInput.inputNodesWithPortPoints[0]._containsTarget = true
  const originalTerminalNodes = structuredClone(
    terminalInput.nodeWithPortPoints,
  )
  const terminalSolver = new UniformPortDistributionSolver(terminalInput)
  terminalSolver.solve()
  expect(terminalSolver.solved).toBe(true)
  expect(terminalSolver.getOutput()).toEqual(originalTerminalNodes)

  const singletonInput = createUniformPhysicalClearanceInput({
    orientation: "horizontal",
    axisStart: 10,
    axisEnd: 14,
    sharedCoordinate: 20,
    portPoints: [
      {
        portPointId: "singleton-port",
        connectionName: "route",
        x: 12,
        y: 20,
        z: 0,
      },
    ],
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 11, y: 20 },
        width: 1,
        height: 1,
        zLayers: [0],
        ownerNetIds: new Set(["left-pad-net"]),
      },
      {
        kind: "fixed-rectangle",
        center: { x: 13, y: 20 },
        width: 1,
        height: 1,
        zLayers: [0],
        ownerNetIds: new Set(["right-pad-net"]),
      },
    ],
    canonicalNetIdByConnectionName: new Map([["route", "route-net"]]),
    traceWidth: 0.5,
    traceToPadClearance: 0.25,
    traceToTraceClearance: 0.25,
  })
  const singletonSolver = new UniformPortDistributionSolver(singletonInput)
  singletonSolver.solve()
  expect(singletonSolver.solved).toBe(true)
  expect(singletonSolver.getOutput()).toEqual(singletonInput.nodeWithPortPoints)
})
