/** @jsxImportSource react-for-pipeline9-fixtures */
import { expect, test } from "bun:test"
import { LengthMatchingSolver } from "@tscircuit/length-matching-solver"
import { LengthMatchingPostProcessingSolver } from "lib/solvers/length-matching-post-processing-solver"
import type { DifferentialPair } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  RootCircuit,
  getSimpleRouteJsonFromCircuitJson,
} from "../fixtures/pipeline9CoreRuntime.mjs"

test("exhausted meander space propagates failure instead of accepting 9.6mm skew", async (): Promise<void> => {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  // Board-world points in mm, +X right, +Y up, +Z above. The short lane has
  // only 0.4 mm of run in a 2 mm-high board; there is no room to add 9.6 mm.
  circuit.add(
    <board width={12} height={2} routingDisabled>
      {[
        { name: "P_START", x: -5, y: -0.5 },
        { name: "P_END", x: -4.6, y: -0.5 },
        { name: "N_START", x: -5, y: 0.5 },
        { name: "N_END", x: 5, y: 0.5 },
      ].map(({ name, x, y }) => (
        <chip
          key={name}
          name={name}
          pcbX={x}
          pcbY={y}
          footprint={
            <footprint>
              <smtpad
                portHints={["pin1"]}
                width={0.2}
                height={0.2}
                shape="rect"
              />
            </footprint>
          }
        />
      ))}
      {/* @ts-expect-error The pinned fixture runtime supports keepout; the repo also loads older core JSX types. */}
      <keepout
        shape="rect"
        pcbY={0}
        width={12}
        height={0.3}
        layers={["top", "bottom"]}
      />
      {/* @ts-expect-error The pinned fixture runtime supports keepout; the repo also loads older core JSX types. */}
      <keepout
        shape="rect"
        pcbX={0.8}
        pcbY={-0.65}
        width={10}
        height={0.7}
        layers={["top", "bottom"]}
      />
      <trace name="P" from=".P_START > .pin1" to=".P_END > .pin1" />
      <trace name="N" from=".N_START > .pin1" to=".N_END > .pin1" />
    </board>,
  )
  await circuit.renderUntilSettled()
  const { simpleRouteJson: srj } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: circuit.getCircuitJson(),
  })
  // Synthetic straight HD copper derived from real TSX terminals; this tests
  // the post-processing boundary, not a full Pipeline9 route.
  const hdRoutes: HighDensityRoute[] = srj.connections.map((connection) => ({
    connectionName: connection.name,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: connection.pointsToConnect.map((point) => ({
      x: point.x,
      y: point.y,
      z: 0,
    })),
  }))
  const params = {
    hdRoutes,
    differentialPairs: [
      {
        connectionNames: [[srj.connections[0].name], [srj.connections[1].name]],
        maxLengthSkewMm: 0.1,
      },
    ] satisfies DifferentialPair[],
    obstacles: srj.obstacles,
    bounds: srj.bounds,
    layerCount: srj.layerCount,
    obstacleMargin: 0.1,
  }
  const direct = new LengthMatchingSolver({
    ...params,
    originalConnections: srj.connections,
  })
  expect(() => direct.solve()).toThrow(
    "no same-layer straight segment can tune",
  )
  expect(direct.failed).toBe(true)
  const solver = new LengthMatchingPostProcessingSolver({
    ...params,
    connections: srj.connections,
    buses: [],
  })
  expect(() => solver.solve()).toThrow(
    "no same-layer straight segment can tune",
  )
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("no same-layer straight segment can tune")
  expect(() => solver.getOutput()).toThrow("before completion")
})
