import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { DifferentialPairRoutingError } from "lib/utils/DifferentialPairRoutingError"
import { getDifferentialPairEsdRepro } from "../fixtures/getDifferentialPairEsdRepro"

test("invalid hop declarations fail with a named error before routing", async (): Promise<void> => {
  const srj = await getDifferentialPairEsdRepro(7)
  const invalidInputs: Array<(input: SimpleRouteJson) => void> = [
    (input): void => {
      input.differentialPairs![0]!.maxLengthSkewMm = -1
    },
    (input): void => {
      input.differentialPairs![0]!.maxLengthSkewMm = Number.NaN
    },
    (input): void => {
      input.differentialPairs![0]!.maxLengthSkewMm = Number.POSITIVE_INFINITY
    },
    (input): void => {
      input.differentialPairs![0]!.connectionNames[0][0] = "missing"
    },
    (input): void => {
      input.differentialPairs![0]!.connectionNames[1][0] = "P:0"
    },
    (input): void => {
      input.differentialPairs![0]!.connectionNames[0].push("P:0")
    },
    (input): void => {
      input.connections.push(input.connections[0]!)
    },
    (input): void => {
      input.connections[0]!.pointsToConnect.push(
        input.connections[1]!.pointsToConnect[1]!,
      )
    },
    (input): void => {
      input.differentialPairs!.push(input.differentialPairs![0]!)
    },
    (input): void => {
      input.differentialPairs![0]!.connectionNames[0].splice(0)
    },
    (input): void => {
      input.connections[0]!.isOffBoard = true
    },
  ]
  for (const invalidate of invalidInputs) {
    const input = structuredClone(srj)
    invalidate(input)
    expect(
      () => new AutoroutingPipelineSolver9_PreloadedTraceGraph(input),
    ).toThrow(DifferentialPairRoutingError)
  }
})
