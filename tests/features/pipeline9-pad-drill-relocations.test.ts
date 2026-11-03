import { expect, test } from "bun:test"
import { checkTracesAreContiguous, checkViasInPads } from "@tscircuit/checks"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { applyPipeline9ViaInPadRelocations } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9ViaInPadRelocations"
import { createPipeline9RelaxedDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9RelaxedDrcEvaluator"
import { convertPipeline7HdRoutesToSimplifiedPcbTraces } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { annotateTraceEndpointPorts } from "lib/utils/autorouting-drc/annotateTraceEndpointPorts"

test("pad drill repair preserves connectivity and rejects blocked, locked and shared via movement", (): void => {
  for (const scenario of [
    "movable",
    "blocked",
    "locked",
    "shared",
    "junction",
    "fixed-junction",
    "preloaded",
    "allowed",
  ]) {
    const srj: SimpleRouteJson = {
      layerCount: 2,
      minTraceWidth: 0.1,
      minViaDiameter: 0.6,
      minViaHoleDiameter: 0.2,
      allowViaInPad: scenario === "allowed",
      bounds: { minX: -3, maxX: 3, minY: -3, maxY: 3 },
      connections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
            { x: 2, y: 1, layer: "bottom", pcb_port_id: "end" },
          ],
        },
      ],
      obstacles: [
        {
          type: "rect",
          shape: "circle",
          center: { x: 0, y: 0 },
          width: 0.4,
          height: 0.4,
          layers: ["top"],
          connectedTo: ["signal", "start"],
          circuitJsonMetadata: { pcb_smtpad_id: "signal_pad" },
        },
      ],
    }
    const routes: HighDensityRoute[] = [
      {
        connectionName: "signal",
        rootConnectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.6,
        vias: [{ x: 0.25, y: 0 }],
        route: [
          { x: 0, y: 0, z: 0, pcb_port_id: "start" },
          { x: 0.25, y: 0, z: 0 },
          { x: 0.25, y: 0, z: 1 },
          { x: 2, y: 1, z: 1, pcb_port_id: "end" },
        ],
      },
    ]
    const fixedRoutes: HighDensityRoute[] = []
    if (scenario === "blocked") {
      for (const [x, y] of [
        [0.65, 0],
        [-0.65, 0],
        [0, 0.65],
        [0, -0.65],
      ]) {
        srj.obstacles.push({
          type: "rect",
          shape: "circle",
          center: { x, y },
          width: 0.4,
          height: 0.4,
          layers: ["top"],
          connectedTo: [`foreign_${x}_${y}`],
          circuitJsonMetadata: { pcb_smtpad_id: `blocker_${x}_${y}` },
        })
      }
    }
    if (scenario === "locked") {
      routes[0]!.route[1]!.pcb_port_id = "fixed_attachment"
    }
    if (scenario === "shared" || scenario === "junction") {
      let startX = 0.25
      if (scenario === "junction") startX = -0.75
      routes.push({
        connectionName: "branch",
        rootConnectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.6,
        vias: [],
        route: [
          { x: startX, y: 0, z: 1 },
          { x: 2, y: 0, z: 1 },
        ],
      })
    }
    if (scenario === "fixed-junction") {
      fixedRoutes.push({
        connectionName: "fixed_branch",
        rootConnectionName: "signal",
        traceThickness: 0.1,
        viaDiameter: 0.6,
        vias: [],
        route: [
          { x: -0.75, y: 0, z: 1 },
          { x: 2, y: 0, z: 1 },
        ],
      })
    }
    const original = structuredClone({ srj, routes })
    const connMap = getConnectivityMapFromSimpleRouteJson(srj)
    const options = {
      originalSrj: srj,
      srjWithPointPairs: srj,
      connections: srj.connections,
      originalConnections: srj.connections,
      obstacles: srj.obstacles,
      layerCount: srj.layerCount,
      defaultViaHoleDiameter: 0.2,
      connMap,
      mutatedPreloadedTraces: [],
    }
    const result = applyPipeline9ViaInPadRelocations({
      srj,
      routes,
      fixedRoutes,
      lockedConnectionNames: new Set(
        scenario === "preloaded" ? ["signal"] : [],
      ),
      drcEvaluator: createPipeline9RelaxedDrcEvaluator(options),
    })
    expect({ srj, routes }).toEqual(original)
    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...options,
      hdRoutes: result.routes,
    })
    const json = convertToCircuitJson(srj, traces)
    annotateTraceEndpointPorts(json)
    if (scenario === "movable") {
      expect(result.acceptedCandidateCount).toBe(1)
      expect(checkViasInPads(json)).toEqual([])
      expect(checkTracesAreContiguous(json)).toEqual([])
      const connectivity = new PcbConnectivityMap(json)
      expect(connectivity.connMap.areAllIdsConnected(["start", "end"])).toBe(
        true,
      )
      expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
      expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
      expect(result.routes[0]!.route[1]!.x).toBe(result.routes[0]!.route[2]!.x)
      expect(result.routes[0]!.route[1]!.y).toBe(result.routes[0]!.route[2]!.y)
    } else {
      expect(result.acceptedCandidateCount).toBe(0)
      expect(result.routes).toEqual(routes)
      expect(checkViasInPads(json)).toHaveLength(1)
    }
  }
})
