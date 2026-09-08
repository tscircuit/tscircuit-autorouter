import { expect, test } from "bun:test"
import { createPipeline9NodePhysicalClearanceContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9NodePhysicalClearanceContext"
import { createNetworkFixedPadProblem } from "../fixtures/createNetworkFixedPadProblem"

test("invalid physical sizes cannot bypass pad-aware node selection through NaN comparisons", (): void => {
  const { node, connMap, fixedPadClearance } = createNetworkFixedPadProblem()
  for (const input of [
    { traceWidth: Number.NaN, viaDiameter: 0.3 },
    { traceWidth: 0, viaDiameter: 0.3 },
    { traceWidth: -0.1, viaDiameter: 0.3 },
    { traceWidth: Number.MIN_VALUE, viaDiameter: 0.3 },
    { traceWidth: 0.2, viaDiameter: Number.POSITIVE_INFINITY },
    { traceWidth: 0.2, viaDiameter: 0 },
    { traceWidth: 0.2, viaDiameter: Number.NaN },
  ]) {
    expect((): void => {
      createPipeline9NodePhysicalClearanceContext({
        node,
        connMap,
        fixedPadClearance,
        layerCount: 2,
        ...input,
      })
    }).toThrow("requires finite physical sizes and clearances")
  }
  for (const invalidGap of [Number.NaN, -0.1, Number.POSITIVE_INFINITY]) {
    for (const gapName of ["traceToPadClearance", "viaToPadClearance"] as const) {
      expect((): void => {
        createPipeline9NodePhysicalClearanceContext({
          node,
          connMap,
          fixedPadClearance: { ...fixedPadClearance, [gapName]: invalidGap },
          layerCount: 2,
          traceWidth: 0.2,
          viaDiameter: 0.3,
        })
      }).toThrow("requires finite physical sizes and clearances")
    }
  }
  expect((): void => {
    createPipeline9NodePhysicalClearanceContext({
      node,
      connMap,
      fixedPadClearance: {
        ...fixedPadClearance,
        traceToPadClearance: Number.MAX_VALUE,
      },
      layerCount: 2,
      traceWidth: Number.MAX_VALUE,
      viaDiameter: 0.3,
    })
  }).toThrow("requires finite physical sizes and clearances")
  for (const invalidNode of [
    { ...node, width: Number.NaN },
    { ...node, center: { x: Number.POSITIVE_INFINITY, y: 0 } },
    {
      ...node,
      center: { x: Number.MAX_VALUE, y: 0 },
      width: Number.MAX_VALUE,
    },
    {
      ...node,
      portPoints: [{ ...node.portPoints[0]!, x: Number.NaN }],
    },
    {
      ...node,
      portPoints: [{ ...node.portPoints[0]!, y: Number.POSITIVE_INFINITY }],
    },
  ]) {
    expect((): void => {
      createPipeline9NodePhysicalClearanceContext({
        node: invalidNode,
        connMap,
        fixedPadClearance,
        layerCount: 2,
        traceWidth: 0.2,
        viaDiameter: 0.3,
      })
    }).toThrow("requires finite physical bounds and port coordinates")
  }
})
