import { expect, test } from "bun:test"
import { AUTOROUTER_VERSION } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/autorouterVersion"
import { HdCache2Client } from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/HdCache2Client"
import {
  PIPELINE9_NETWORKED_SOLVE_POLICY,
  type Pipeline9NetworkedHighDensityNodeInput,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_Networked/pipeline9NetworkedTypes"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { ExampleHdCache2Server } from "tests/fixtures/example-hd-cache2-server"

test("force validation accepts rounding and projected vias while retaining connectivity checks", async (): Promise<void> => {
  const ports = [
    { x: 4.4675, y: 0, z: 0, connectionName: "signal", pcb_port_id: "a" },
    { x: 6.5, y: 0, z: 1, connectionName: "signal", pcb_port_id: "b" },
    { x: 5.2, y: 1, z: 0, connectionName: "signal", pcb_port_id: "c" },
    {
      x: -0.33250000000000013,
      y: 1,
      z: 0,
      connectionName: "signal",
      pcb_port_id: "d",
    },
    { x: 3.0001, y: 1.5, z: 0, connectionName: "collapsed", pcb_port_id: "e" },
    { x: 3.0002, y: 1.5, z: 0, connectionName: "collapsed", pcb_port_id: "f" },
  ]
  const input: Pipeline9NetworkedHighDensityNodeInput = {
    solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY,
    enableRegionalFallback: false,
    nodeWithPortPoints: {
      capacityMeshNodeId: "rounding",
      center: { x: 3, y: 0 },
      width: 8,
      height: 4,
      availableZ: [0, 1],
      portPoints: ports,
      portPointsInPairs: [
        [ports[0]!, ports[2]!],
        [ports[1]!, ports[3]!],
        [ports[4]!, ports[5]!],
      ],
    },
    connectivityNetMap: { signal: ["signal"], collapsed: ["collapsed"] },
    colorMap: {},
    viaDiameter: 0.3,
    traceWidth: 0.15,
    obstacleMargin: 0.15,
    effort: 1,
    obstacles: [],
    regionalObstacles: [],
    layerCount: 2,
    nodePf: 0.1,
    forceImprove: {
      totalStepsPerNode: 20,
      nodeAssignmentMargin: 0.2,
      preserveTerminalPcbPortIds: true,
    },
  }
  // Real force projection keeps these transition coordinates, while deriveVias
  // rounds independently to 0.001 mm. Pre-force floating error also puts the
  // two half-grid terminals on the opposite side of Math.round(input).
  const transition = { x: 5.9910598776916135, y: 0.267055461172225 }
  const routes: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "signal",
      regionId: "rounding",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      startPcbPortId: "a",
      endPcbPortId: "b",
      route: [
        { x: 4.467, y: 0, z: 0 },
        { x: 5.2, y: 0, z: 0 },
        { ...transition, z: 0 },
        { ...transition, z: 1 },
        { x: 6.5, y: 0, z: 1 },
      ],
      vias: [{ x: 5.991, y: 0.267 }],
    },
    {
      connectionName: "signal",
      regionId: "rounding",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      startPcbPortId: "c",
      endPcbPortId: "d",
      route: [
        { x: 5.2, y: 1, z: 0 },
        { x: 5.2, y: 0, z: 0 },
        { x: -0.332, y: 1, z: 0 },
      ],
      vias: [],
    },
    {
      connectionName: "collapsed",
      regionId: "rounding",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      startPcbPortId: "e",
      endPcbPortId: "f",
      route: [
        { x: 3, y: 1.5, z: 0 },
        { x: 3, y: 1.5, z: 0 },
      ],
      vias: [],
    },
  ]
  let responseRoutes = routes
  const server = new ExampleHdCache2Server({
    mapSolveEnvelope: (envelope, request) => ({
      ...envelope,
      status: "solved",
      solutionStage: "ordinary",
      forceImproved: request.input.forceImprove ? true : undefined,
      routes: responseRoutes,
    }),
  })
  const check = async (
    forced: boolean,
    changedRoutes: HighDensityIntraNodeRoute[],
    expectedKind: "remote" | "local-fallback",
  ): Promise<void> => {
    responseRoutes = changedRoutes
    const client = new HdCache2Client(AUTOROUTER_VERSION, server.url)
    const [result] = await Promise.all(
      client.solveMany([
        {
          ...input,
          forceImprove: forced ? input.forceImprove : undefined,
        },
      ]),
    )
    expect(result!.kind).toBe(expectedKind)
    if (result!.kind === "local-fallback")
      expect(result!.reason).toBe("invalid_response")
  }
  try {
    await check(true, routes, "remote")
    const rawRoutes = structuredClone(routes)
    rawRoutes[0]!.route[0]!.x = ports[0]!.x
    rawRoutes[1]!.route.at(-1)!.x = ports[3]!.x
    rawRoutes[2]!.route[0]!.x = ports[4]!.x
    rawRoutes[2]!.route[1]!.x = ports[5]!.x
    rawRoutes[0]!.vias = [{ ...transition }]
    await check(false, rawRoutes, "remote")
    await check(false, routes, "local-fallback")
    const rawRoundedVia = structuredClone(rawRoutes)
    rawRoundedVia[0]!.vias = routes[0]!.vias
    await check(false, rawRoundedVia, "local-fallback")
    const displacedTerminal = structuredClone(routes)
    displacedTerminal[0]!.route[0]!.x -= 0.0001
    await check(true, displacedTerminal, "local-fallback")
    const displacedVia = structuredClone(routes)
    displacedVia[0]!.vias[0]!.x += 0.002
    await check(true, displacedVia, "local-fallback")
    const disconnected = structuredClone(routes)
    disconnected[1]!.route.splice(1, 1)
    await check(true, disconnected, "local-fallback")
    const wrongTerminalId = structuredClone(routes)
    wrongTerminalId[0]!.startPcbPortId = "b"
    await check(true, wrongTerminalId, "local-fallback")
  } finally {
    await server.close()
  }
})
