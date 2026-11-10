import { expect, test } from "bun:test"
import { resolveDifferentialPairSegments } from "lib/utils/resolveDifferentialPairSegments"
import { createDifferentialPairSegmentInput } from "./fixtures/createDifferentialPairSegmentInput"
import { multiTerminalDifferentialPair } from "./fixtures/multiTerminalDifferentialPair"

test("pairs four-terminal members by geometry regardless of segment order or direction", (): void => {
  const srj = structuredClone(multiTerminalDifferentialPair)
  for (const [index, connection] of srj.connections.entries()) {
    connection.pointsToConnect.push({ x: 30, y: 1 - index, layer: "top" })
    for (const point of connection.pointsToConnect) delete point.port_selector
  }
  const input = createDifferentialPairSegmentInput(srj)
  input.connections.reverse()
  const negative = input.connections.filter((connection): boolean =>
    connection.__rootConnectionNames!.includes("USB_N"),
  )
  for (const [index, connection] of negative.entries()) {
    connection.pointsToConnect.reverse()
    const route = input.hdRoutes.find(
      (route): boolean => route.connectionName === connection.name,
    )!
    connection.name = `negative_segment_${index}`
    route.connectionName = connection.name
    route.traceThickness = 0.25
  }

  const pairs = resolveDifferentialPairSegments(input)

  expect(pairs).toHaveLength(3)
  for (const pair of pairs) {
    const [positiveSegment, negativeSegment] = pair.connectionNames.map(
      (name): number[] =>
        input.connections
          .find((connection): boolean => connection.name === name)!
          .pointsToConnect.map((point): number => point.x)
          .sort((a, b): number => a - b),
    )
    expect(positiveSegment).toEqual(negativeSegment)
    expect(pair.minimumCenterlineDistance).toBeCloseTo(0.5)
    expect(pair.maximumCenterlineDistance).toBeCloseTo(0.5)
    expect(pair.maxUncoupledLength).toBe(3)
  }
})
