import { expect, test } from "bun:test"
import { resolvePipeline9PadAreaTerminals } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PadAreaTerminals"
import { createPipeline9PadAreaTerminalInput } from "./fixtures/createPipeline9PadAreaTerminalInput"

test("pad-area landing clearance uses actual high-density minimum width and preserves later preferred width metadata", (): void => {
  for (const minTraceWidth of [0.25, 0.5]) {
    const originalSrj = createPipeline9PadAreaTerminalInput()
    originalSrj.minTraceWidth = minTraceWidth
    originalSrj.nominalTraceWidth = 1
    originalSrj.connections[0]!.nominalTraceWidth = 1.25
    originalSrj.buses = [
      {
        busId: "source-bus",
        connectionNames: ["net-a"],
        maxLengthSkew: 0,
        traceWidth: 1.5,
      },
    ]
    const routingSrj = structuredClone(originalSrj)
    routingSrj.nominalTraceWidth = 1.75
    routingSrj.connections[0]!.nominalTraceWidth = 2
    routingSrj.buses![0]!.traceWidth = 2.25
    const originalBefore = structuredClone(originalSrj)
    const routingBefore = structuredClone(routingSrj)
    const result = resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })
    const landing = result.connections[0]!.pointsToConnect[0]!
    expect(landing.x).toBeCloseTo(minTraceWidth === 0.25 ? 0.63 : 0.54, 12)
    expect(landing.y).toBe(0)
    expect(result.minTraceWidth).toBe(minTraceWidth)
    expect(result.nominalTraceWidth).toBe(1.75)
    expect(result.connections[0]!.nominalTraceWidth).toBe(2)
    expect(result.buses).toBe(routingSrj.buses)
    expect(result.buses![0]!.traceWidth).toBe(2.25)
    expect(originalSrj).toEqual(originalBefore)
    expect(routingSrj).toEqual(routingBefore)
  }

  const originalSrj = createPipeline9PadAreaTerminalInput()
  originalSrj.connections[0]!.pointsToConnect[0]!.x = 0.7
  originalSrj.connections[0]!.nominalTraceWidth = 2
  originalSrj.nominalTraceWidth = 2
  originalSrj.buses = [
    {
      busId: "wide-preference",
      connectionNames: ["net-a"],
      maxLengthSkew: 0,
      traceWidth: 2,
    },
  ]
  const routingSrj = structuredClone(originalSrj)
  const originalBefore = structuredClone(originalSrj)
  const routingBefore = structuredClone(routingSrj)
  expect(resolvePipeline9PadAreaTerminals({ originalSrj, routingSrj })).toBe(
    routingSrj,
  )
  expect(originalSrj).toEqual(originalBefore)
  expect(routingSrj).toEqual(routingBefore)

  const mismatchedRoutingSrj = structuredClone(routingSrj)
  mismatchedRoutingSrj.minTraceWidth = 0.5
  expect((): void => {
    resolvePipeline9PadAreaTerminals({
      originalSrj,
      routingSrj: mismatchedRoutingSrj,
    })
  }).toThrow("same minimum trace width")
  for (const invalidWidth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalidOriginal = structuredClone(originalSrj)
    const invalidRouting = structuredClone(routingSrj)
    invalidOriginal.minTraceWidth = invalidWidth
    invalidRouting.minTraceWidth = invalidWidth
    expect((): void => {
      resolvePipeline9PadAreaTerminals({
        originalSrj: invalidOriginal,
        routingSrj: invalidRouting,
      })
    }).toThrow()
  }
})
