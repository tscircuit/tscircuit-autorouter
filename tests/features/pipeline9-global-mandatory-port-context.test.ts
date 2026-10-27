import { expect, test } from "bun:test"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9HighDensityBatchSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensityBatchSolver"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import type { NodeWithPortPoints, HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import actual from "../fixtures/sample24-hdr77584-board-transitions.json"
import actualPeer from "../fixtures/sample24-hdr77584-mandatory-neighbor.json"

class ExposedPipeline9HighDensity extends Pipeline9HighDensitySolver {
  routeNode(node: NodeWithPortPoints): HighDensityIntraNodeRoute[] {
    this.startRegularSolver(node)
    this.activeRegularSolver!.solve()
    if (!this.activeRegularSolver!.solved) throw new Error(this.activeRegularSolver!.error ?? "Regular routing failed")
    return this.activeRegularSolver!.routes
  }
}

test("P9 keeps the entire fixed-port cohort through regular, regional, batch and grow routing", () => {
  const node = structuredClone(actual.nodeWithPortPoints) as NodeWithPortPoints
  const peer = structuredClone(actualPeer) as NodeWithPortPoints
  const point = peer.portPoints.find((p) => p.portPointId === "ce408253_pp0_z4::4")!
  const connMap = new ConnectivityMap(actual.connectivityNetMap)
  const params = { ...actual.options, obstacles: actual.obstacles as Obstacle[], connMap, fixedHdRoutes: [], colorMap: {} }
  const before = JSON.stringify({ node, peer, params })
  const distance = (routes: HighDensityIntraNodeRoute[]): number => {
    const route = routes.find((r) => r.connectionName === "source_net_altium_pcb_299")!
    const distances: number[] = []
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!, b = route.route[i]!
      if (a.z === point.z && b.z === point.z) distances.push(pointToSegmentDistance(point, a, b))
    }
    return Math.min(...distances)
  }
  const isolated = new ExposedPipeline9HighDensity({ ...params, nodePortPoints: [node] })
  expect(distance(isolated.routeNode(node))).toBeLessThan(0.2)
  const parent = new ExposedPipeline9HighDensity({ ...params, nodePortPoints: [node, peer] })
  expect(distance(parent.routeNode(node))).toBeGreaterThanOrEqual(0.2 - 1e-9)
  const regional = new Pipeline9RegionalFallbackSolver({ ...params, nodeWithPortPoints: node,
    mandatoryPortPointIndex: parent.mandatoryPortPointIndex })
  regional.highDensitySolver.solve()
  expect(regional.highDensitySolver.solved).toBe(true)
  expect(distance(regional.highDensitySolver.routes)).toBeGreaterThanOrEqual(0.2 - 1e-9)
  const batch = new Pipeline9HighDensityBatchSolver({ ...params, nodePortPoints: [node],
    connectivityNetMap: connMap.netMap, mandatoryPortPointIndex: structuredClone(parent.mandatoryPortPointIndex), maxIterations: 1000000 })
  batch.solve()
  expect(batch.solved).toBe(true)
  expect(batch.getOutput()[0]!.solved).toBe(true)
  expect(distance(batch.getOutput()[0]!.routes)).toBeGreaterThanOrEqual(0.2 - 1e-9)
  expect(JSON.stringify({ node, peer, params })).toBe(before)
})
