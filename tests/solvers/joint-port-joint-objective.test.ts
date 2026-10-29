import { expect, test } from "bun:test"
import { optimizeJointPortCoordinates } from "lib/solvers/UniformPortDistributionSolver/optimizeJointPortCoordinates"
import { createJointPortTestInput } from "./joint-port-test-input"

test("shared coordinates optimize both adjacent routes and update every paired copy immutably", (): void => {
  const input = createJointPortTestInput()
  const before = structuredClone(input)
  const result = optimizeJointPortCoordinates(input)
  expect(result.stats.active).toBeTrue()
  expect(result.stats.candidatePortCount).toBe(1)
  expect(result.stats.eligiblePortCount).toBe(1)
  expect(result.stats.movedPortCount).toBe(1)
  expect(result.stats.objectiveAfter).toBeLessThan(result.stats.objectiveBefore)
  expect(result.stats.objectiveAfter).toBeCloseTo(8, 6)
  for (let i = 0; i < result.nodes.length; i++) {
    const port = result.nodes[i].portPoints.find((point) => point.portPointId === "shared-0")!
    expect(port.x).toBe(0)
    expect(port.y).toBeCloseTo(1, 5)
    expect(port.z).toBe(0)
    expect(port.rootConnectionName).toBe("root-0")
    expect(port.prevPortPointId).toBe("start-0")
    expect(port.nextPortPointId).toBe("end-0")
    const pairPort = result.nodes[i].portPointsInPairs![0].find((point) => point.portPointId === "shared-0")!
    expect(pairPort).toEqual(port)
    const terminal = result.nodes[i].portPoints.find((point) => point.pcb_port_id)!
    expect(terminal).toEqual(input.nodes[i].portPoints.find((point) => point.pcb_port_id)!)
  }
  expect(input).toEqual(before)
  expect(optimizeJointPortCoordinates(input)).toEqual(result)
})
