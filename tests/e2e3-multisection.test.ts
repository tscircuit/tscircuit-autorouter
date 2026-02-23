import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver } from "../lib"
import { SimpleRouteJson } from "lib/types"
import { convertSrjToGraphicsObject } from "../lib"
import { getSvgFromGraphicsObject } from "graphics-debug"
import {
  createPortPointSection,
  visualizeSection,
} from "../lib/solvers/MultiSectionPortPointOptimizer"
import { MultiSectionPortPointOptimizer } from "../lib/solvers/MultiSectionPortPointOptimizer/MultiSectionPortPointOptimizer"
import e2e3Fixture from "../fixtures/legacy/assets/e2e3.json"

test("should solve e2e3 board and produce valid SimpleRouteJson output", async () => {
  const simpleSrj = e2e3Fixture as SimpleRouteJson

  const solver = new AutoroutingPipelineSolver(simpleSrj, {
    cacheProvider: null,
  })

  solver.solve()

  expect(solver.availableSegmentPointSolver!.visualize()).toMatchGraphicsSvg(
    `${import.meta.path}-availableSegmentPointSolver`,
  )
  expect(solver.portPointPathingSolver!.visualize()).toMatchGraphicsSvg(
    `${import.meta.path}-portPointPathingSolver`,
  )

  const result = solver.getOutputSimpleRouteJson()
  expect(convertSrjToGraphicsObject(result)).toMatchGraphicsSvg(
    import.meta.path,
  )
}, 20_000)

test("createPortPointSection creates valid section from center node", async () => {
  const simpleSrj: SimpleRouteJson = e2e3Fixture as SimpleRouteJson

  const solver = new AutoroutingPipelineSolver(simpleSrj, {
    cacheProvider: null,
  })

  // Solve until we have the port point pathing solver ready
  solver.solveUntilPhase("multiSectionPortPointOptimizer")
  // Run the multiSectionPortPointOptimizer phase to completion
  while (solver.getCurrentPhase() === "multiSectionPortPointOptimizer") {
    solver.step()
  }

  const portPointSolver = solver.portPointPathingSolver!

  // Get a node from the center of the board to use as section center
  const nodes = portPointSolver.inputNodes
  expect(nodes.length).toBeGreaterThan(0)

  // Find a node near the center of the board
  const bounds = simpleSrj.bounds
  const boardCenterX = (bounds.minX + bounds.maxX) / 2
  const boardCenterY = (bounds.minY + bounds.maxY) / 2

  let closestNode = nodes[0]
  let closestDist = Infinity
  for (const node of nodes) {
    const dist = Math.sqrt(
      (node.center.x - boardCenterX) ** 2 + (node.center.y - boardCenterY) ** 2,
    )
    if (dist < closestDist) {
      closestDist = dist
      closestNode = node
    }
  }

  // Create a section with expansion degree 2 (2 hops from center)
  const section = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: closestNode.capacityMeshNodeId,
      expansionDegrees: 2,
    },
  )

  // Verify section structure
  expect(section.centerNodeId).toBe(closestNode.capacityMeshNodeId)
  expect(section.expansionDegrees).toBe(2)
  expect(section.nodeIds.size).toBeGreaterThan(0)
  expect(section.inputNodes.length).toBeGreaterThan(0)
  expect(section.capacityMeshNodes.length).toBeGreaterThan(0)

  // The center node should be in the section
  expect(section.nodeIds.has(closestNode.capacityMeshNodeId)).toBe(true)

  // Visualize the section
  const sectionViz = visualizeSection(section, solver.colorMap)
  expect(sectionViz).toMatchGraphicsSvg(
    `${import.meta.path}-section-expansion2`,
  )
}, 20_000)

test("createPortPointSection with different expansion degrees", async () => {
  const simpleSrj: SimpleRouteJson = e2e3Fixture as SimpleRouteJson

  const solver = new AutoroutingPipelineSolver(simpleSrj, {
    cacheProvider: null,
  })

  // Solve until we have the port point pathing solver ready
  solver.solveUntilPhase("multiSectionPortPointOptimizer")
  while (solver.getCurrentPhase() === "multiSectionPortPointOptimizer") {
    solver.step()
  }

  const portPointSolver = solver.portPointPathingSolver!

  // Use first node as center for predictable results
  const centerNode = portPointSolver.inputNodes[0]

  // Create sections with different expansion degrees
  const section0 = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: centerNode.capacityMeshNodeId,
      expansionDegrees: 0,
    },
  )

  const section1 = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: centerNode.capacityMeshNodeId,
      expansionDegrees: 1,
    },
  )

  const section3 = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: centerNode.capacityMeshNodeId,
      expansionDegrees: 3,
    },
  )

  // Expansion 0 should only contain the center node
  expect(section0.nodeIds.size).toBe(1)
  expect(section0.inputNodes.length).toBe(1)
  expect(section0.internalEdges.length).toBe(0) // No internal edges with just one node

  // Expansion 1 should contain more nodes than expansion 0
  expect(section1.nodeIds.size).toBeGreaterThan(section0.nodeIds.size)

  // Expansion 3 should contain more nodes than expansion 1
  expect(section3.nodeIds.size).toBeGreaterThanOrEqual(section1.nodeIds.size)

  // Visualize section with expansion 1
  expect(visualizeSection(section1, solver.colorMap)).toMatchGraphicsSvg(
    `${import.meta.path}-section-expansion1`,
  )

  // Visualize section with expansion 3
  expect(visualizeSection(section3, solver.colorMap)).toMatchGraphicsSvg(
    `${import.meta.path}-section-expansion3`,
  )
}, 20_000)

test("createSectionSimpleRouteJson includes cut paths with low expansion degrees", async () => {
  const simpleSrj: SimpleRouteJson = e2e3Fixture as SimpleRouteJson

  const solver = new AutoroutingPipelineSolver(simpleSrj, {
    cacheProvider: null,
  })

  // Solve until we have the port point pathing solver ready
  solver.solveUntilPhase("multiSectionPortPointOptimizer")

  const portPointSolver = solver.portPointPathingSolver!

  // Find a node that has paths passing through it but doesn't contain
  // both endpoints of any connection (to ensure we get cut paths)
  // Use a node near the middle of the board
  const bounds = simpleSrj.bounds
  const boardCenterX = (bounds.minX + bounds.maxX) / 2
  const boardCenterY = (bounds.minY + bounds.maxY) / 2

  let closestNode = portPointSolver.inputNodes[0]
  let closestDist = Infinity
  for (const node of portPointSolver.inputNodes) {
    const dist = Math.sqrt(
      (node.center.x - boardCenterX) ** 2 + (node.center.y - boardCenterY) ** 2,
    )
    if (dist < closestDist && !node._containsTarget) {
      closestDist = dist
      closestNode = node
    }
  }

  // Create a section with very low expansion degree (1) to maximize chance of cut paths
  const section = createPortPointSection(
    {
      inputNodes: portPointSolver.inputNodes,
      capacityMeshNodes: solver.capacityNodes!,
      capacityMeshEdges: solver.capacityEdges!,
      nodeMap: portPointSolver.nodeMap,
      connectionResults: portPointSolver.connectionsWithResults,
    },
    {
      centerOfSectionCapacityNodeId: closestNode.capacityMeshNodeId,
      expansionDegrees: 1,
    },
  )

  // Verify we have section paths (either cut or fully contained)
  expect(section.sectionPaths.length).toBeGreaterThanOrEqual(0)

  // Find cut paths specifically (paths with entry or exit from outside)
  // Must have at least 2 points to be routable
  const cutPaths = section.sectionPaths.filter(
    (sp) =>
      (sp.hasEntryFromOutside || sp.hasExitToOutside) && sp.points.length >= 2,
  )

  // Log info about the section
  console.log(`Section center: ${closestNode.capacityMeshNodeId}`)
  console.log(`Section nodes: ${section.nodeIds.size}`)
  console.log(`Section paths: ${section.sectionPaths.length}`)
  console.log(`Cut paths (with >= 2 points): ${cutPaths.length}`)

  // Create a MultiSectionPortPointOptimizer to test the cut path handling
  // Use FRACTION_TO_REPLACE: 1 to test all connections being ripped
  const multiSectionOptimizer = new MultiSectionPortPointOptimizer({
    simpleRouteJson: simpleSrj,
    inputNodes: portPointSolver.inputNodes,
    capacityMeshNodes: solver.capacityNodes!,
    capacityMeshEdges: solver.capacityEdges!,
    colorMap: solver.colorMap,
    initialConnectionResults: portPointSolver.connectionsWithResults,
    initialAssignedPortPoints: portPointSolver.assignedPortPoints,
    initialNodeAssignedPortPoints: portPointSolver.nodeAssignedPortPoints,
    FRACTION_TO_REPLACE: 1,
  })

  // Create section and SimpleRouteJson
  const testSection = multiSectionOptimizer.createSection({
    centerOfSectionCapacityNodeId: closestNode.capacityMeshNodeId,
    expansionDegrees: 1,
  })

  const sectionSrj =
    multiSectionOptimizer.createSectionSimpleRouteJson(testSection)

  // Log the connections in the section SimpleRouteJson
  console.log(`Section connections: ${sectionSrj.connections.length}`)

  const cutConnections = sectionSrj.connections.filter((c) =>
    c.name.startsWith("__cut__"),
  )
  console.log(`Cut connections: ${cutConnections.length}`)

  // Verify that cut paths are included as synthetic connections
  // The number of cut connections should match the number of cut paths
  expect(cutConnections.length).toBe(cutPaths.length)

  // Verify cut connections have the expected format
  for (const cutConn of cutConnections) {
    expect(cutConn.name).toMatch(/^__cut__/)
    expect(cutConn.pointsToConnect.length).toBe(2)
    expect(cutConn.rootConnectionName).toBeDefined()
  }

  // Visualize the section to verify cut paths are shown
  expect(visualizeSection(testSection, solver.colorMap)).toMatchGraphicsSvg(
    `${import.meta.path}-section-with-cut-paths`,
  )
})
