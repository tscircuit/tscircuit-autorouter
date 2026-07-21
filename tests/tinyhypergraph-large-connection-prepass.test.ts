import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import type { HgPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("TinyHypergraph runs the congested-port prepass for large connection sets", () => {
  const params = structuredClone(input) as HgPortPointPathingSolverParams
  const template = params.connections[0]!
  params.connections = Array.from({ length: 461 }, (_, index) => {
    const connection = structuredClone(template)
    connection.connectionId = `connection-${index}`
    connection.mutuallyConnectedNetworkId = "shared-net"
    connection.simpleRouteConnection!.name = `connection-${index}`
    connection.simpleRouteConnection!.__rootConnectionNames = ["shared-net"]
    connection.simpleRouteConnection!.pointsToConnect =
      connection.simpleRouteConnection!.pointsToConnect.map((point) => ({
        ...point,
        pointId: `${point.pointId}-${index}`,
      }))
    return connection
  })

  const solver = new TinyHypergraphPortPointPathingSolver(params)
  const prepassReport = (
    solver as unknown as {
      duplicateCongestedPortReport?: unknown
    }
  ).duplicateCongestedPortReport

  expect(prepassReport).toBeDefined()
})
