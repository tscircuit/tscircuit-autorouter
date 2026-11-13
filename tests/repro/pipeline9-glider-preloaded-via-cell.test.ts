import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { AnyCircuitElement } from "circuit-json"
import { PcbConnectivityMap } from "circuit-json-to-connectivity-map"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { removeChangedSectionsFromFixedHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializeHypergraphPreloadedTraceSections"
import type { ChangedPreloadedTraceSection } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import {
  hasPreloadedTraceSectionMetadata,
  serializePreloadedTraceAssignments,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/serializePreloadedTraceAssignments"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { replaceNativePcbTraces } from "tests/fixtures/replaceNativePcbTraces"

type GliderViaCellFixture = {
  circuitJson: AnyCircuitElement[]
  srj: SimpleRouteJson
  graph: SerializedHyperGraph
}

test("Glider DDR via outside the shared routing cell", async (): Promise<void> => {
  // Glider v1.0: all 379 components and 459 native nets. These boundary ports
  // were captured before routing the other signals in tscircuit 0.0.3172.
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/glider-ddr-via-cell.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as GliderViaCellFixture
  const trace = fixture.srj.traces!.find(
    (trace) => trace.pcb_trace_id === "source_net_389_0",
  )
  if (!trace) throw new Error("Missing native DRAM_LDQSP copper")
  const stats = serializePreloadedTraceAssignments(fixture.graph)
  expect(stats.preloadedAssignmentCount).toBe(1)
  const sections: ChangedPreloadedTraceSection[] = []
  for (const connection of fixture.graph.connections ?? []) {
    if (!hasPreloadedTraceSectionMetadata(connection)) continue
    const section = connection.preloadedTraceSection
    sections.push({
      connectionName: connection.connectionId,
      traceId: section.traceId,
      startRoutePosition: section.startRoutePosition,
      endRoutePosition: section.endRoutePosition,
      connection: {
        name: connection.connectionId,
        pointsToConnect: [section.startPoint, section.endPoint].map(
          (point) => ({
            x: point.x,
            y: point.y,
            layer: mapZToLayerName(point.z, fixture.srj.layerCount),
          }),
        ),
      },
    })
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.srj)
  const fixedRoutes = convertPreloadedTraceToHdRoutes(
    trace,
    0,
    fixture.srj.layerCount,
    fixture.srj.minViaDiameter!,
    connMap,
  )
  const retainedRoutes = removeChangedSectionsFromFixedHdRoutes({
    traces: [trace],
    fixedHdRoutes: fixedRoutes,
    sections,
  })
  const retainedTraces: SimplifiedPcbTrace[] = retainedRoutes.map(
    (route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `retained_dqs_${index}`,
      connection_name: trace.connection_name,
      route: convertHdRouteToSimplifiedRoute(route, fixture.srj.layerCount, {
        defaultViaHoleDiameter: fixture.srj.minViaHoleDiameter!,
      }),
    }),
  )
  // Render the real fixed copper supplied to high-density routing. Copper
  // removed for a mutable section is absent until that section can be routed.
  const circuit = replaceNativePcbTraces({
    circuitJson: fixture.circuitJson,
    srj: fixture.srj,
    traces: retainedTraces,
  })
  expect(
    circuit.filter((element) => element.type === "source_component"),
  ).toHaveLength(379)
  expect(
    circuit.filter((element) => element.type === "source_trace"),
  ).toHaveLength(459)
  const source = circuit.find(
    (element) =>
      element.type === "source_trace" &&
      element.display_name === "/fpga_ddr/DRAM_LDQSP",
  )
  if (source?.type !== "source_trace") throw new Error("Missing native DDR net")
  const portIds = circuit.flatMap((element) =>
    element.type === "pcb_port" &&
    source.connected_source_port_ids.includes(element.source_port_id)
      ? [element.pcb_port_id]
      : [],
  )
  expect(portIds).toHaveLength(2)
  expect(
    new PcbConnectivityMap(circuit).connMap.areAllIdsConnected(portIds),
  ).toBeFalse()
  const renderOptions = {
    backgroundColor: "white",
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    colorOverrides: {
      substrate: "#ffffff",
      boardOutline: "#475569",
      silkscreen: { top: "#334155", bottom: "#334155" },
      copper: {
        top: "#dc2626",
        inner1: "#2563eb",
        inner2: "#16a34a",
        bottom: "#0891b2",
      },
    },
  }
  await expect(
    convertCircuitJsonToPcbSvg(circuit, {
      ...renderOptions,
      width: 1400,
      height: 1000,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { scale: 1 })
  const dqsTraceIds = new Set(
    circuit.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id === source.source_trace_id
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const focusedCircuit = circuit
    .filter((element) => {
      if (element.type === "pcb_trace")
        return dqsTraceIds.has(element.pcb_trace_id)
      if (element.type === "pcb_via")
        return dqsTraceIds.has(element.pcb_trace_id!)
      return true
    })
    .map(
      (element): AnyCircuitElement =>
        element.type === "pcb_board"
          ? {
              ...element,
              center: { x: -20.5, y: -12.2 },
              width: 2,
              height: 2,
              outline: undefined,
            }
          : element,
    )
  await expect(
    convertCircuitJsonToPcbSvg(focusedCircuit, {
      ...renderOptions,
      width: 900,
      height: 900,
      drawPaddingOutsideBoard: false,
    }),
  ).toMatchSvgSnapshot(import.meta.path, { svgName: "dqs-via", scale: 1 })
})
