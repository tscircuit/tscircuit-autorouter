import { expect, test } from "bun:test"
import { optimizeJointPortCoordinates } from "lib/solvers/UniformPortDistributionSolver/optimizeJointPortCoordinates"
import { createJointPortTestInput } from "./joint-port-test-input"

test("terminals and incomplete or ambiguous ownership remain fixed", (): void => {
  const cases = Array.from({ length: 9 }, () => createJointPortTestInput())
  for (const node of cases[0].nodes) node.portPoints.find((point) => point.portPointId === "shared-0")!.pcb_port_id = "locked"
  cases[1].srj.connections[0].pointsToConnect.push({ x: 0, y: 0, layer: "top" })
  cases[2].inputNodes[0]._containsTarget = true
  cases[3].inputNodes.forEach((node) => {
    node.portPoints = node.portPoints.filter((point) => !point.portPointId.startsWith("shared-"))
  })
  cases[4].nodes[0].portPoints.push({ ...cases[4].nodes[0].portPoints.find((point) => point.portPointId === "shared-0")! })
  cases[5].nodes[1].portPointsInPairs = undefined
  cases[6].nodes[1].portPoints.find((point) => point.portPointId === "shared-0")!.z = 1
  cases[7].inputNodes[1].portPoints.find((point) => point.portPointId === "shared-0")!
    .connectionNodeIds = ["right", "unrepresented-third-owner"]
  cases[8].nodes[0].portPointsInPairs![0][0] = { ...cases[8].nodes[0].portPointsInPairs![0][0], x: -100 }
  for (const input of cases) {
    const before = structuredClone(input)
    const result = optimizeJointPortCoordinates(input)
    expect(result.stats.eligiblePortCount).toBe(0)
    expect(result.stats.movedPortCount).toBe(0)
    expect(result.nodes).toEqual(input.nodes)
    expect(input).toEqual(before)
  }
})
