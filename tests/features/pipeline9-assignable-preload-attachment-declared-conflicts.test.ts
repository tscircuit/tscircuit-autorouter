import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9AssignableAttachmentInput } from "./fixtures/createPipeline9AssignableAttachmentInput"

test("obstacle, trace and coordinate unions cannot hide competing declared attachment identities", (): void => {
  for (const mergeSource of ["obstacle", "trace", "coordinate"] as const) {
    const originalSrj = createPipeline9AssignableAttachmentInput()
    originalSrj.connections.push({
      name: "foreign-net",
      pointsToConnect: [
        {
          x: mergeSource === "coordinate" ? 0.001 : 6,
          y: mergeSource === "coordinate" ? 0.001 : 0,
          layer: "top",
          pcb_port_id: "foreign-a",
        },
        { x: 7, y: 1, layer: "top", pcb_port_id: "foreign-b" },
      ],
    })
    if (mergeSource === "obstacle") {
      originalSrj.obstacles[0]!.connectedTo.push("foreign-a")
    } else if (mergeSource === "trace") {
      originalSrj.traces![0]!.connectsTo!.push("foreign-a")
    } else {
      originalSrj.traces!.push({
        type: "pcb_trace",
        pcb_trace_id: "foreign-existing-copper",
        connection_name: "foreign-net",
        connectsTo: ["foreign-a", "foreign-b"],
        route: [
          { route_type: "wire", x: 0.3, y: 0.3, width: 0.1, layer: "top" },
          { route_type: "wire", x: 7, y: 1, width: 0.1, layer: "top" },
        ],
      })
    }
    const fullMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
    expect(fullMap.getNetConnectedToId("declared-net")).toBe(
      fullMap.getNetConnectedToId("foreign-net"),
    )
    const originalSnapshot = structuredClone(originalSrj)
    const routingSrj = structuredClone(originalSrj)
    const output = resolvePipeline9PreloadedTerminalAttachments({
      originalSrj,
      routingSrj,
    })

    expect(output).toBe(routingSrj)
    expect(output).toEqual(originalSnapshot)
    expect(originalSrj).toEqual(originalSnapshot)
  }
})
