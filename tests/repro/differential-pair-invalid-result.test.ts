import { expect, test } from "bun:test"
import { getRoutingFailure, type RoutingFailure } from "lib"
import { validateDifferentialPairs } from "lib/utils/validateDifferentialPairs"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("invalid selections and unsupported phases carry serializable typed diagnostics", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  srj.connections[0]!.routingPcbGroupId = "other-phase"
  for (const reason of [
    "unsupported_routing_scope",
    "invalid_differential_pair",
  ] as const) {
    try {
      validateDifferentialPairs(srj)
      throw new Error("Expected validation to fail")
    } catch (error) {
      const failure: RoutingFailure = getRoutingFailure(error)
      expect(failure.reason).toBe(reason)
      if (
        failure.reason !== "unsupported_routing_scope" &&
        failure.reason !== "invalid_differential_pair"
      )
        throw error
      expect(failure.pairIndex).toBe(0)
      expect(typeof failure.detail).toBe("string")
      expect(
        getRoutingFailure(
          JSON.parse(JSON.stringify({ routingFailure: failure })),
        ),
      ).toEqual(failure)
    }
    srj.differentialPairs![0]!.maxLengthSkewMm = -1
  }
})
