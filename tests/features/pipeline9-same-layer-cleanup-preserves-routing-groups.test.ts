import { expect, test } from "bun:test"
import { getSameLayerViaRemovalInput } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getSameLayerViaRemovalInput"

test("same-layer cleanup does not reroute one branch of a differential pair independently", (): void => {
  const problem = getSameLayerViaRemovalInput({
    srj: {
      layerCount: 2,
      minTraceWidth: 0.15,
      bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10 },
      connections: [],
      obstacles: [],
      differentialPairs: [
        { connectionNames: ["pair-p", "pair-n"], lengthTolerance: 0.1 },
      ],
    },
    routes: [
      {
        connectionName: "branch",
        rootConnectionName: "pair-p",
        traceThickness: 0.15,
        viaDiameter: 0.5,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
          { x: 1, y: 0, z: 1 },
          { x: 2, y: 0, z: 1 },
          { x: 2, y: 0, z: 0 },
          { x: 3, y: 0, z: 0 },
        ],
        vias: [
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      },
    ],
    fixedRoutes: [],
    routeIndex: 0,
  })

  expect(problem).toBeUndefined()
})
