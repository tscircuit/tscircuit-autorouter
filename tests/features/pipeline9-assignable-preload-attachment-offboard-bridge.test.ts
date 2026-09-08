import { expect, test } from "bun:test"
import { resolvePipeline9PreloadedTerminalAttachments } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/resolvePipeline9PreloadedTerminalAttachments"
import { createPipeline9AssignableAttachmentInput } from "./fixtures/createPipeline9AssignableAttachmentInput"

test("attachment eligibility follows transitive off-board groups without assigning their copper", (): void => {
  for (const competingClaim of [false, true]) {
    const originalSrj = createPipeline9AssignableAttachmentInput()
    originalSrj.obstacles.push(
      {
        obstacleId: "bridge-pad",
        type: "rect",
        center: { x: 4.5, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: [],
        netIsAssignable: true,
        offBoardConnectsTo: ["off-board-a", "off-board-b"],
      },
      {
        obstacleId: "remote-pad",
        type: "rect",
        center: { x: 6, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: [competingClaim ? "foreign-a" : "port-c"],
        netIsAssignable: true,
        offBoardConnectsTo: ["off-board-b"],
      },
    )
    if (competingClaim) {
      originalSrj.connections.push({
        name: "foreign-net",
        pointsToConnect: [
          { x: 6, y: 0, layer: "top", pcb_port_id: "foreign-a" },
          { x: 7, y: 1, layer: "top", pcb_port_id: "foreign-b" },
        ],
      })
    }
    const snapshot = structuredClone(originalSrj)
    const routingSrj = structuredClone(originalSrj)
    const output = resolvePipeline9PreloadedTerminalAttachments({
      originalSrj,
      routingSrj,
    })

    if (competingClaim) {
      expect(output).toBe(routingSrj)
    } else {
      expect(output).not.toBe(routingSrj)
      expect(output.connections[0]!.pointsToConnect[0]).toMatchObject({
        x: 0.2,
        y: 0.2,
        layer: "top",
        pcb_port_id: "port-a",
      })
    }
    expect(output.obstacles).toBe(routingSrj.obstacles)
    expect(output.obstacles).toEqual(snapshot.obstacles)
    expect(output.traces).toBe(routingSrj.traces)
    expect(originalSrj).toEqual(snapshot)
    expect(routingSrj).toEqual(snapshot)
  }
})
