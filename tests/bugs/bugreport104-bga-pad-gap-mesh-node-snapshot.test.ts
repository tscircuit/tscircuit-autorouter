import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { InitialBgaTopologySolver } from "lib/solvers/BgaTopologyGeneratorSolver/InitialBgaTopologySolver"
import { loadBugreport104InitialBgaTopologyInput } from "../fixtures/loadBugreport104InitialBgaTopologyInput"

test("bugreport104 BGA pad gap mesh node visualization snapshot", (): void => {
  const initialBgaInput = loadBugreport104InitialBgaTopologyInput()
  const solver = new InitialBgaTopologySolver(initialBgaInput)
  solver.solve()

  expect(solver.solved).toBe(true)

  const srj = initialBgaInput.srj
  const minTraceChannelWidth =
    srj.minTraceWidth + 2 * srj.minTraceToPadEdgeClearance!
  const redRects = solver
    .getOutput()
    .filter(
      (node) =>
        (node.capacityMeshNodeId.includes("cmn_h_") ||
          node.capacityMeshNodeId.includes("cmn_v_")) &&
        node.availableZ.includes(0) &&
        Math.min(node.width, node.height) < minTraceChannelWidth,
    )
    .map((node) => ({
      center: node.center,
      width: node.width,
      height: node.height,
      fill: "rgba(220, 38, 38, 0.6)",
      stroke: "#b91c1c",
      label: `z0 gap ${Math.min(node.width, node.height).toFixed(2)}mm`,
    }))

  const viz = solver.visualize()
  const bounds = initialBgaInput.componentBounds
  const graphics = {
    ...viz,
    rects: [...(viz.rects ?? []), ...redRects],
    texts: [
      ...(viz.texts ?? []),
      {
        x: (bounds.minX + bounds.maxX) / 2,
        y: bounds.maxY + 0.08,
        text: "Red: pad-layer nodes in pad gaps narrower than a trace channel",
        fontSize: 0.05,
        anchorSide: "center" as const,
      },
    ],
  }

  expect(
    getSvgFromGraphicsObject(graphics, {
      backgroundColor: "white",
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
