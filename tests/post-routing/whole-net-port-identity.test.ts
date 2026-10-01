import { expect, test } from "bun:test"
import { preparePostRoutingWholeNetInput } from "lib/solvers/PostRoutingOptimization/preparePostRoutingWholeNetInput"
import { createDynamicNetTreeProblem } from "lib/solvers/DynamicNetTreeSolver/createDynamicNetTreeProblem"
import { boardFixture, wireTrace } from "./fixtures"

test("point-pair records sharing exact physical ports form one isolated whole net with every endpoint and unchanged copper", () => {
  const input = boardFixture()
  const signal = input.srj.connections[0]!
  signal.pointsToConnect.forEach((p) => {
    p.pcb_port_id = p.pointId
  })
  input.srj.connections.push({
    name: "signal-complete",
    pointsToConnect: [
      ...structuredClone(signal.pointsToConnect),
      { x: 10, y: 5, layer: "top", pointId: "extra", pcb_port_id: "extra" },
    ],
  })
  const traces = [
    wireTrace("routed", "generated-alias", [
      [0, 0],
      [10, 0],
    ]),
  ]
  const original = structuredClone({ srj: input.srj, traces })
  const prepared = preparePostRoutingWholeNetInput(
    input.srj,
    traces,
    [],
    ["signal-complete"],
    [
      {
        name: "generated-alias",
        __rootConnectionNames: ["signal"],
        pointsToConnect: structuredClone(signal.pointsToConnect),
      },
    ],
  )
  expect(prepared.srj.connections).toHaveLength(2)
  expect(
    prepared.srj.connections.find((c) => c.name === "signal-complete")!
      .pointsToConnect,
  ).toHaveLength(3)
  expect(prepared.traceOwners.get("generated-alias")).toBe("signal-complete")
  expect(prepared.traces).toEqual(traces)
  expect(prepared.srj.minTraceToPadEdgeClearance).toBe(
    input.srj.minTraceToPadEdgeClearance,
  )
  const problem = createDynamicNetTreeProblem(
    prepared.srj,
    "signal-complete",
    [],
    prepared.traceOwners,
  )
  expect(
    problem.copper.filter((c) => c.owner === "signal-complete"),
  ).toHaveLength(2)
  prepared.srj.connections[0]!.pointsToConnect[0]!.x = 999
  expect({ srj: input.srj, traces }).toEqual(original)
})
