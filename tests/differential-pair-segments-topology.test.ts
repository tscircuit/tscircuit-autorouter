import { expect, test } from "bun:test"
import { resolveDifferentialPairSegments } from "lib/utils/resolveDifferentialPairSegments"
import { createDifferentialPairSegmentInput } from "./fixtures/createDifferentialPairSegmentInput"
import { multiTerminalDifferentialPair } from "./fixtures/multiTerminalDifferentialPair"

test("rejects equal segment counts with incompatible terminal trees", (): void => {
  const input = createDifferentialPairSegmentInput(structuredClone(multiTerminalDifferentialPair))
  const negative = input.connections.filter(
    (connection): boolean => connection.__rootConnectionNames!.includes("USB_N"),
  )
  negative[0]!.pointsToConnect = [
    multiTerminalDifferentialPair.connections[1]!.pointsToConnect[2]!,
    multiTerminalDifferentialPair.connections[1]!.pointsToConnect[0]!,
  ]

  expect((): ReturnType<typeof resolveDifferentialPairSegments> => resolveDifferentialPairSegments(input)).toThrow(
    "the terminal trees must have matching topology",
  )
})
