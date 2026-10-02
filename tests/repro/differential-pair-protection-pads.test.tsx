import { expect, test } from "bun:test"
import { RootCircuit, getSimpleRouteJsonFromCircuitJson } from "@tscircuit/core"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { getSvgFromGraphicsObject, type GraphicsObject } from "graphics-debug"

test("differential pair with protection pads is rejected before topology planning", async (): Promise<void> => {
  const circuit = new RootCircuit()
  circuit.schematicDisabled = true
  // U1 models the two flow-through protection pads on each conductor.
  circuit.add(
    <board width={24} height={12} routingDisabled>
      <chip
        name="U1"
        pcbX={0}
        pinLabels={{ pin1: "P_IN", pin2: "N_IN", pin3: "P_OUT", pin4: "N_OUT" }}
        footprint={
          <footprint>
            <smtpad
              shape="rect"
              portHints={["pin1"]}
              pcbX={-1}
              pcbY={1}
              width={0.6}
              height={0.6}
            />
            <smtpad
              shape="rect"
              portHints={["pin2"]}
              pcbX={-1}
              pcbY={-1}
              width={0.6}
              height={0.6}
            />
            <smtpad
              shape="rect"
              portHints={["pin3"]}
              pcbX={1}
              pcbY={1}
              width={0.6}
              height={0.6}
            />
            <smtpad
              shape="rect"
              portHints={["pin4"]}
              pcbX={1}
              pcbY={-1}
              width={0.6}
              height={0.6}
            />
          </footprint>
        }
      />
      <chip
        name="J1"
        pcbX={-8}
        pinLabels={{ pin1: "P", pin2: "N" }}
        footprint={
          <footprint>
            <smtpad
              shape="rect"
              portHints={["pin1"]}
              pcbY={1}
              width={0.6}
              height={0.6}
            />
            <smtpad
              shape="rect"
              portHints={["pin2"]}
              pcbY={-1}
              width={0.6}
              height={0.6}
            />
          </footprint>
        }
      />
      <chip
        name="J2"
        pcbX={8}
        pinLabels={{ pin1: "P", pin2: "N" }}
        footprint={
          <footprint>
            <smtpad
              shape="rect"
              portHints={["pin1"]}
              pcbY={1}
              width={0.6}
              height={0.6}
            />
            <smtpad
              shape="rect"
              portHints={["pin2"]}
              pcbY={-1}
              width={0.6}
              height={0.6}
            />
          </footprint>
        }
      />
      <trace from=".J1 > .pin1" to="net.P" />
      <trace from=".U1 > .pin1" to="net.P" />
      <trace from=".U1 > .pin3" to="net.P" />
      <trace from=".J2 > .pin1" to="net.P" />
      <trace from=".J1 > .pin2" to="net.N" />
      <trace from=".U1 > .pin2" to="net.N" />
      <trace from=".U1 > .pin4" to="net.N" />
      <trace from=".J2 > .pin2" to="net.N" />
    </board>,
  )
  await circuit.renderUntilSettled()
  const { simpleRouteJson } = getSimpleRouteJsonFromCircuitJson({
    circuitJson: circuit.getCircuitJson(),
    minTraceWidth: 0.15,
  })
  const positiveNet = circuit.db.source_net.getWhere({ name: "P" })!
  const negativeNet = circuit.db.source_net.getWhere({ name: "N" })!
  // Declare the pair at the router boundary; the pinned core predates this primitive.
  const input: SimpleRouteJson = {
    ...simpleRouteJson,
    traces: [],
    differentialPairs: [
      {
        connectionNames: [positiveNet.source_net_id, negativeNet.source_net_id],
        lengthTolerance: 0.15,
      },
    ],
  }
  expect(
    input.connections.map((connection) => connection.pointsToConnect.length),
  ).toEqual([4, 4])
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.failed).toBe(true)
  expect(solver.solved).toBe(false)
  expect(solver.error).toBe(
    `Differential pair connection "${positiveNet.source_net_id}" resolves to 3 point-pair connections; exactly one is supported. Declare each constrained point-to-point segment as a separate differential pair.`,
  )
  expect(solver.netToPointPairsSolver?.newConnections).toHaveLength(6)
  expect(solver.topologyPlanningSolver).toBeUndefined()
  expect(solver.effortCleanupSolver).toBeUndefined()
  await expect(
    getSvgFromGraphicsObject(convertSrjToGraphicsObject(input), {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "input" })
  const rejectedGraphics: GraphicsObject = convertSrjToGraphicsObject(input)
  rejectedGraphics.texts = [
    {
      x: -8,
      y: 4,
      fontSize: 0.4,
      anchorSide: "center_left",
      text: "Rejected before routing: 3 segments per pair member",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(rejectedGraphics, {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "before-rejection" })
})
