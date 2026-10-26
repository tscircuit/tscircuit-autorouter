import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { createIsThroughViaLandingBlocked } from "lib/solvers/NodeDimensionSubdivisionSolver/createIsThroughViaLandingBlocked"
import { splitThroughOnlyGlobalFreeNodes } from "lib/solvers/NodeDimensionSubdivisionSolver/splitThroughOnlyGlobalFreeNodes"
import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"

test("only a complete convex ownership proof removes through-via landings and preserves legal overhang", (): void => {
  const fixture = JSON.parse(
    readFileSync(
      new URL(
        "../fixtures/sample24/through-via-landing-domains.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    blockedNode: CapacityMeshNode
    legalOverhangNode: CapacityMeshNode
    physicalSrj: SimpleRouteJson
  }
  const { blockedNode, legalOverhangNode, physicalSrj } = fixture
  const snapshot = structuredClone(fixture)
  const isBlocked = createIsThroughViaLandingBlocked(physicalSrj)
  expect(isBlocked(blockedNode)).toBe(true)
  expect(isBlocked(legalOverhangNode)).toBe(false)
  const ownedPth: CapacityMeshNode = {
    ...blockedNode,
    capacityMeshNodeId: "protected-owned-pth",
    _containsTarget: true,
    _containsObstacle: true,
    _connectedTo: ["owner"],
  }
  const nodes = [blockedNode, legalOverhangNode, ownedPth]
  const policy = { layerCount: 8, physicalSrj }
  const split = splitThroughOnlyGlobalFreeNodes(nodes, policy)
  expect(split).toHaveLength(10)
  expect(split.slice(0, 8).map((node) => node.availableZ)).toEqual(
    Array.from({ length: 8 }, (_, z) => [z]),
  )
  expect(split[8]).toBe(legalOverhangNode)
  expect(split[9]).toBe(ownedPth)
  for (const z of blockedNode.availableZ) {
    expect(
      split
        .filter((node) => node.availableZ.includes(z))
        .reduce((area, node) => area + node.width * node.height, 0),
    ).toBe(nodes.reduce((area, node) => area + node.width * node.height, 0))
  }
  expect(fixture).toEqual(snapshot)
  expect(
    splitThroughOnlyGlobalFreeNodes(nodes, {
      ...policy,
      allowBlindAndBuriedVias: true,
    }),
  ).toBe(nodes)

  const cell: CapacityMeshNode = {
    capacityMeshNodeId: "synthetic-cell",
    layer: "z0",
    center: { x: 0, y: 0 },
    width: 0.02,
    height: 0.02,
    availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
  }
  const first: Obstacle = {
    type: "rect",
    center: { x: 0, y: 0 },
    width: 1,
    height: 1,
    layers: ["top"],
    connectedTo: ["first-owner"],
  }
  const second: Obstacle = {
    ...first,
    layers: ["bottom"],
    connectedTo: ["second-owner"],
  }
  // One owner can legally reuse its own pad. Two aliases for that owner also
  // leave a landing; disjoint physical owners forbid it for every routed net.
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [first],
    })(cell),
  ).toBe(false)
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [first, second],
    })(cell),
  ).toBe(true)
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [first, second],
      connections: [
        {
          name: "first-owner",
          __rootConnectionNames: ["second-owner"],
          pointsToConnect: [],
        },
      ],
    })(cell),
  ).toBe(false)
  const barrier = { ...first, connectedTo: [] }
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [barrier],
    })(cell),
  ).toBe(true)
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [{ ...barrier, netIsAssignable: true }],
    })(cell),
  ).toBe(false)

  // DRC accepts equality at the 5 um tolerance. Opaque barriers have no added
  // pad-clearance rule, even when the board declares a pad clearance.
  const boundaryCell = { ...cell, center: { x: 0.74, y: 0 }, width: 0.01 }
  const typedPad = {
    ...barrier,
    circuitJsonMetadata: { pcb_smtpad_id: "typed-unowned-pad" },
  }
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [typedPad],
    })(boundaryCell),
  ).toBe(false)
  const slightlyInside = { ...boundaryCell, center: { x: 0.739, y: 0 } }
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [typedPad],
    })(slightlyInside),
  ).toBe(true)
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [barrier],
    })(slightlyInside),
  ).toBe(false)

  // Use the actual rotated rectangle, never the enclosing square as copper.
  const rotated = { ...barrier, height: 0.2, ccwRotationDegrees: 45 }
  const rotatedProof = createIsThroughViaLandingBlocked({
    ...physicalSrj,
    obstacles: [rotated],
  })
  expect(rotatedProof(cell)).toBe(true)
  expect(rotatedProof({ ...cell, center: { x: 0.4, y: -0.4 } })).toBe(false)
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: [{ ...barrier, shape: "circle" }],
    })(cell),
  ).toBe(false)

  // Four separate corner obstacles do not prove their nonconvex union covers
  // the interior. Every blocker must cover the entire rectangle on its own.
  const corners = [-1, 1].flatMap((x) =>
    [-1, 1].map((y) => ({
      ...barrier,
      center: { x, y },
      width: 0.01,
      height: 0.01,
    })),
  )
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      obstacles: corners,
    })({ ...cell, width: 2, height: 2 }),
  ).toBe(false)

  // Explicit pad diameter wins over the deprecated diameter; drill diameter
  // remains a lower bound on the actual generated copper pad.
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      minViaPadDiameter: 0.2,
      minViaDiameter: 0.5,
    })(blockedNode),
  ).toBe(false)
  expect(
    createIsThroughViaLandingBlocked({
      ...physicalSrj,
      min_via_pad_diameter: 0.1,
      min_via_hole_diameter: 0.3,
    })(blockedNode),
  ).toBe(true)
})
