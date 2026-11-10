import { expect, test } from "bun:test"
import { resolveDifferentialPairSegments } from "lib/utils/resolveDifferentialPairSegments"
import { createDifferentialPairSegmentInput } from "./fixtures/createDifferentialPairSegmentInput"
import { multiTerminalDifferentialPair } from "./fixtures/multiTerminalDifferentialPair"

test("rejects ambiguous terminal geometry instead of guessing a segment pairing", (): void => {
  const srj = structuredClone(multiTerminalDifferentialPair)
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) delete point.port_selector
  }
  srj.connections[1]!.pointsToConnect[1] = { x: 0, y: 2, layer: "top" }
  const input = createDifferentialPairSegmentInput(srj)

  expect(
    (): ReturnType<typeof resolveDifferentialPairSegments> =>
      resolveDifferentialPairSegments(input),
  ).toThrow("has no unique corresponding terminal")
})
