import { expect, test } from "bun:test"
import { createViaInPadEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createViaInPadEvaluator"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type ViaRouteOptions = {
  x: number
  viaDiameter?: number
  fromZ?: number
  toZ?: number
}

function createViaRoute({
  x,
  viaDiameter = 0.6,
  fromZ = 0,
  toZ = 1,
}: ViaRouteOptions): HighDensityRoute {
  return {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter,
    vias: [{ x, y: 0 }],
    route: [
      { x: 2, y: 1, z: fromZ },
      { x, y: 0, z: fromZ },
      { x, y: 0, z: toZ },
      { x: 2, y: -1, z: toZ },
    ],
  }
}

test("regional repair checks the drilled hole and its physical layer span", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.6,
    minViaHoleDiameter: 0.2,
    allowViaInPad: false,
    bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
    connections: [],
    obstacles: [
      {
        type: "rect",
        shape: "circle",
        center: { x: 0, y: 0 },
        width: 0.4,
        height: 0.4,
        layers: ["top"],
        connectedTo: ["signal"],
        circuitJsonMetadata: { pcb_smtpad_id: "signal_pad" },
      },
    ],
  }
  const previousRoutes = [createViaRoute({ x: 2 })]
  const evaluate = createViaInPadEvaluator({ srj, previousRoutes })
  // The copper annulus overlaps this same-net pad; the drill stays outside it.
  for (const x of [0.36, 0.31, 0.3]) {
    const entersPad = evaluate([createViaRoute({ x })])
    expect(entersPad).toBe(false)
  }
  const drillEntersPad = evaluate([createViaRoute({ x: 0.29 })])
  expect(drillEntersPad).toBe(true)
  const evaluateExistingDrill = createViaInPadEvaluator({
    srj,
    previousRoutes: [createViaRoute({ x: 0 })],
  })
  const changesOnlyCopper = evaluateExistingDrill([
    createViaRoute({ x: 0, viaDiameter: 0.8 }),
  ])
  expect(changesOnlyCopper).toBe(false)

  const internalTransition = [createViaRoute({ x: 0, fromZ: 1, toZ: 2 })]
  expect(evaluate(internalTransition)).toBe(true)
  const evaluateBlindVias = createViaInPadEvaluator({
    srj: { ...srj, allowBlindAndBuriedVias: true },
    previousRoutes,
  })
  const blindHoleEntersPad = evaluateBlindVias(internalTransition)
  expect(blindHoleEntersPad).toBe(false)

  // The baseline is a snapshot of drills, not a live reference to route points.
  previousRoutes[0]!.route[1]!.x = 0
  previousRoutes[0]!.route[2]!.x = 0
  previousRoutes[0]!.vias[0]!.x = 0
  expect(evaluate(previousRoutes)).toBe(true)
})
