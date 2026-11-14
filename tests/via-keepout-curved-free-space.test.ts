import { expect, test } from "bun:test"
import { splitNodesAtViaKeepouts } from "lib/utils/splitNodesAtViaKeepouts"
import type { ViaKeepout } from "lib/types/srj-types"

test("curved and diagonal keepouts do not discard free corners inside their bounding boxes", () => {
  const keepouts: ViaKeepout[] = [
    { shape: "circle", center: { x: 0, y: 0 }, radius: 4.7, layers: ["top"] },
    {
      shape: "outline",
      outline: [
        { x: -5, y: -5 },
        { x: 5, y: 5 },
      ],
      strokeWidth: 0.2,
      layers: ["top"],
    },
  ]
  for (const keepout of keepouts) {
    const nodes = splitNodesAtViaKeepouts(
      [
        {
          capacityMeshNodeId: "board",
          center: { x: 0, y: 0 },
          width: 10,
          height: 10,
          layer: "top",
          availableZ: [0, 1],
        },
      ],
      [keepout],
      0.6,
      2,
    )
    const corner = { x: -4.5, y: 4.5 }
    expect(
      nodes.some(
        (n) =>
          n.availableZ.length === 2 &&
          Math.abs(n.center.x - corner.x) <= n.width / 2 &&
          Math.abs(n.center.y - corner.y) <= n.height / 2,
      ),
    ).toBe(true)
    expect(
      nodes
        .filter((n) => Math.abs(n.center.x) < 0.1 && Math.abs(n.center.y) < 0.1)
        .every((n) => n.availableZ.length === 1),
    ).toBe(true)
  }
})
