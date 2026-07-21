import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import type {
  HgPortPointPathingSolverParams,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

test("TinyHypergraph adds only the strongest cross-layer attachment for each target", () => {
  const params = structuredClone(input) as HgPortPointPathingSolverParams
  const targetRegion = params.graph.regions.find(
    (region) => region.regionId === "bl",
  )!
  const networkRegion = params.graph.regions.find(
    (region) => region.regionId === "left-bridge",
  )!
  targetRegion.d._containsTarget = true
  params.graph.ports = params.graph.ports.filter(
    (port) => port.d.portId !== "p5",
  )
  for (const region of params.graph.regions) {
    region.ports = region.ports.filter((port) => port.d.portId !== "p5")
  }

  const singleLayerCandidate: RegionHg = {
    regionId: "single-layer-candidate",
    ports: [],
    d: {
      capacityMeshNodeId: "single-layer-candidate",
      center: { ...targetRegion.d.center },
      width: 1.5,
      height: 1.5,
      layer: "top",
      availableZ: [1],
    },
  }
  const multilayerCandidate: RegionHg = {
    regionId: "multilayer-candidate",
    ports: [],
    d: {
      capacityMeshNodeId: "multilayer-candidate",
      center: { ...targetRegion.d.center },
      width: 1.5,
      height: 1.5,
      layer: "top",
      availableZ: [1, 2],
    },
  }
  const singleLayerPort: RegionPortHg = {
    portId: "candidate-port-1",
    region1: singleLayerCandidate,
    region2: networkRegion,
    d: {
      portId: "candidate-port-1",
      x: -3.5,
      y: -1.5,
      z: 1,
      distToCentermostPortOnZ: 0,
      regions: [singleLayerCandidate, networkRegion],
    },
  }
  const multilayerPort: RegionPortHg = {
    portId: "candidate-port-2",
    region1: multilayerCandidate,
    region2: networkRegion,
    d: {
      portId: "candidate-port-2",
      x: -3.5,
      y: -2.5,
      z: 1,
      distToCentermostPortOnZ: 0,
      regions: [multilayerCandidate, networkRegion],
    },
  }
  singleLayerCandidate.ports.push(singleLayerPort)
  multilayerCandidate.ports.push(multilayerPort)
  networkRegion.ports.push(singleLayerPort, multilayerPort)
  networkRegion.d.availableZ = [0, 1, 2]
  params.graph.regions.push(singleLayerCandidate, multilayerCandidate)
  params.graph.ports.push(singleLayerPort, multilayerPort)
  params.layerCount = 3
  params.preserveTerminalPcbPortIds = true

  const solver = new TinyHypergraphPortPointPathingSolver(params)
  const serializedGraph = (
    solver as unknown as {
      tinyPipelineSolver: {
        inputProblem: { serializedHyperGraph: SerializedHyperGraph }
      }
    }
  ).tinyPipelineSolver.inputProblem.serializedHyperGraph
  const attachmentPorts = serializedGraph.ports.filter((port) =>
    port.portId.startsWith("tiny-target-attachment-port:bl:"),
  )
  const bridgeRegions = serializedGraph.regions.filter((region) =>
    region.regionId.startsWith("tiny-target-attachment-bridge-region:bl:"),
  )

  expect(bridgeRegions).toHaveLength(1)
  expect(bridgeRegions[0]?.d.netId).toBeDefined()
  expect(attachmentPorts).toHaveLength(2)
  expect(
    attachmentPorts.some((port) => port.region2Id === "multilayer-candidate"),
  ).toBe(true)
  expect(
    serializedGraph.regions.find(
      (region) => region.regionId === "multilayer-candidate",
    )?.d.availableZ,
  ).toEqual([1, 2])
})
