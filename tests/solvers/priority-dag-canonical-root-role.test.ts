import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { PriorityDagIntraNodeSolver } from "lib/solvers/HighDensitySolver/PriorityDagIntraNodeSolver"
import { priorityParams } from "./priorityDagTestUtils"

test("only canonical factory context grants synthetic section roots registered ownership", (): void => {
  const params = priorityParams()
  params.nodeWithPortPoints.portPoints = params.nodeWithPortPoints.portPoints.map((point) =>
    point.connectionName === "a" ? { ...point, connectionName: "synthetic-section", rootConnectionName: "netA" } : point,
  )
  const connMap = new ConnectivityMap({ netA: ["a"], netB: ["netA", "b"] })
  const raw = new PriorityDagIntraNodeSolver({ ...params, connMap })
  const canonical = new PriorityDagIntraNodeSolver({ ...params, connMap, rootConnectionNamesAreCanonical: true })
  const tasks = Reflect.get(raw, "tasks") as { connectionName: string }[]
  const section = tasks.findIndex((task) => task.connectionName === "synthetic-section")
  expect(connMap.getNetConnectedToId("netA")).toBe("netB")
  expect(Reflect.get(raw, "owner")[section]).toBe(JSON.stringify(["literal", "synthetic-section"]))
  expect(Reflect.get(canonical, "owner")[section]).toBe(JSON.stringify(["registered", "netA"]))
})
