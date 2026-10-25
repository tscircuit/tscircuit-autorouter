import {
  getPngBufferFromGraphicsObject,
  getSvgFromGraphicsObject,
} from "graphics-debug"
import { TopologyMergingSolver } from "../../lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createStripedTopologyMergeInput } from "../../tests/fixtures/createStripedTopologyMergeInput"

const count = Number(Bun.argv[2] ?? 160)
const suffix = count === 160 ? "" : `-${count}`
const solver = new TopologyMergingSolver(createStripedTopologyMergeInput(count))
solver.solve()
if (!solver.solved || solver.failed || solver.getOutput().length !== count * 6) {
  throw new Error("Cannot publish an incomplete topology")
}
const graphics = solver.visualize()
for (const [index, rect] of (graphics.rects ?? []).entries()) {
  delete rect.label
  if (solver.getOutput()[index]!._isComponentTopologyNode) rect.fill = "#f59e0b"
}
graphics.title = `Completed topology: ${count * 2} source nodes, ${count * 6} output nodes`
await Bun.write(
  `docs/topology-streaming/completed${suffix}.svg`,
  getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
)
await Bun.write(
  `../topology-streaming-completed${suffix}.png`,
  await getPngBufferFromGraphicsObject(graphics, {
    backgroundColor: "white",
    pngWidth: 1536,
    pngHeight: 1536,
  }),
)
