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
    "overlapping-pads",
    "offset-transition",
    "duplicate-via-vertex",
    "locked-duplicate-via-vertex",
    "blocked",
    "locked",
    "shared",
    "junction",
    "fixed-junction",
    "aliased-junction",
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
    if (scenario === "overlapping-pads") {
      srj.obstacles.push({
        ...srj.obstacles[0]!,
        center: { x: 0.25, y: 0 },
        circuitJsonMetadata: { pcb_smtpad_id: "second_signal_pad" },
      })
      routes[0]!.vias[0]!.x = 0.125
      routes[0]!.route[1]!.x = 0.125
      routes[0]!.route[2]!.x = 0.125
    }
    if (scenario === "offset-transition") {
      routes[0]!.route[2]!.x = 0.255
      routes[0]!.vias[0]!.x = 0.255
    }
    if (
      scenario === "duplicate-via-vertex" ||
      scenario === "locked-duplicate-via-vertex"
    ) {
      routes[0]!.route.splice(1, 0, { ...routes[0]!.route[1]! })
      if (scenario === "locked-duplicate-via-vertex") {
        routes[0]!.route[1]!.pcb_port_id = "fixed_attachment"
      }
    }
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
    if (scenario === "fixed-junction" || scenario === "aliased-junction") {
      let rootConnectionName = "signal"
      if (scenario === "aliased-junction") {
        rootConnectionName = "signal_alias"
        srj.obstacles[0]!.connectedTo.push(rootConnectionName)
      }
      fixedRoutes.push({
        connectionName: "fixed_branch",
        rootConnectionName,
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
      connMap,
      drcEvaluator: createPipeline9RelaxedDrcEvaluator(options),
    })
    expect({ srj, routes }).toEqual(original)
    const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      ...options,
      hdRoutes: result.routes,
    })
    const json = convertToCircuitJson(srj, traces)
    annotateTraceEndpointPorts(json)
    if (
      scenario === "movable" ||
      scenario === "overlapping-pads" ||
      scenario === "offset-transition" ||
      scenario === "duplicate-via-vertex"
    ) {
      expect(result.acceptedCandidateCount).toBeGreaterThan(0)
      expect(result.attemptedCandidateCount).toBeLessThanOrEqual(64)
      expect(checkViasInPads(json)).toEqual([])
      expect(checkTracesAreContiguous(json)).toEqual([])
      const connectivity = new PcbConnectivityMap(json)
      expect(connectivity.connMap.areAllIdsConnected(["start", "end"])).toBe(
        true,
      )
      expect(result.routes[0]!.route[0]).toEqual(routes[0]!.route[0])
      expect(result.routes[0]!.route.at(-1)).toEqual(routes[0]!.route.at(-1))
      expect(result.routes[0]!.vias).toHaveLength(1)
      const transitionIndex = result.routes[0]!.route.findIndex(
        (point, index, points) => index > 0 && point.z !== points[index - 1]!.z,
      )
      const before = result.routes[0]!.route[transitionIndex - 1]!
      const after = result.routes[0]!.route[transitionIndex]!
      expect(before.x).toBe(after.x)
      expect(before.y).toBe(after.y)
    } else {
      expect(result.acceptedCandidateCount).toBe(0)
      expect(result.routes).toEqual(routes)
      expect(checkViasInPads(json)).toHaveLength(1)
    }
  }
})
