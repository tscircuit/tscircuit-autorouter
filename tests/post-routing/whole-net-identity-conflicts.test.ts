import { expect, test } from "bun:test"
import { preparePostRoutingWholeNetInput } from "lib/solvers/PostRoutingOptimization/preparePostRoutingWholeNetInput"
import { boardFixture, wireTrace } from "./fixtures"

test("whole-net ownership never joins coincident coordinates, prefixes, foreign aliases or contradictory explicit port rules", () => {
  const input = boardFixture()
  const signal = input.srj.connections[0]!,
    fixed = input.srj.connections[1]!
  fixed.pointsToConnect[0]!.x = signal.pointsToConnect[0]!.x
  fixed.pointsToConnect[0]!.y = signal.pointsToConnect[0]!.y
  const known = [
    wireTrace("known", "signal", [
      [0, 0],
      [10, 0],
    ]),
  ]
  expect(
    preparePostRoutingWholeNetInput(input.srj, known, [], ["signal"]).srj
      .connections,
  ).toHaveLength(2)
  expect(() =>
    preparePostRoutingWholeNetInput(
      input.srj,
      [
        wireTrace("unknown", "signal-prefix", [
          [0, 0],
          [10, 0],
        ]),
      ],
      [],
      ["signal"],
    ),
  ).toThrow("one explicit whole-net owner")
  const cross = { ...known[0]!, connectsTo: ["a", "c"] }
  expect(() =>
    preparePostRoutingWholeNetInput(input.srj, [cross], [], ["signal"]),
  ).toThrow("found 2")
  for (const defect of [
    "position",
    "layers",
    "width",
    "declared-net",
    "duplicate-plan",
    "port-identity",
    "terminal-via",
  ] as const) {
    const srj = structuredClone(input.srj)
    const alias = { ...structuredClone(signal), name: "signal-alias" }
    if (defect === "position") alias.pointsToConnect[0]!.x += 1
    if (defect === "layers") alias.pointsToConnect[0]!.layer = "bottom"
    if (defect === "width") alias.nominalTraceWidth = 0.9
    if (defect === "port-identity") alias.pointsToConnect[0]!.pcb_port_id = "b"
    if (defect === "terminal-via")
      alias.pointsToConnect[0] = {
        ...alias.pointsToConnect[0]!,
        layer: "top",
        layers: undefined,
        terminalVia: { toLayer: "bottom", viaDiameter: 0.6 },
      }
    if (defect === "declared-net") {
      srj.connections[0]!.__netConnectionName = "declared-a"
      alias.__netConnectionName = "declared-b"
    }
    srj.connections.push(alias)
    const original = structuredClone(srj)
    expect(() =>
      preparePostRoutingWholeNetInput(
        srj,
        known,
        [],
        defect === "duplicate-plan" ? ["signal", "signal-alias"] : ["signal"],
      ),
    ).toThrow()
    expect(srj).toEqual(original)
  }
})
