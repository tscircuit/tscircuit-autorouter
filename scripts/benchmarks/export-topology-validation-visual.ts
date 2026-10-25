import { getPngBufferFromGraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { validateTopologyMergingOutput } from "../../lib/solvers/TopologyMergingSolver/topology-merging-output"
import { createRectFromCapacityNode } from "../../lib/utils/createRectFromCapacityNode"
import { createDisjointTopologyValidationInput } from "../../tests/fixtures/createDisjointTopologyValidationInput"
const { input } = createDisjointTopologyValidationInput(256, false)
validateTopologyMergingOutput(input)
const rects = input.nodes.map(node => createRectFromCapacityNode(node, { rectMargin: 0.02 }))
for (const rect of rects) delete rect.label
const graphics = { title: "256 valid disjoint native capacity regions", rects }
await Bun.write("docs/topology-validation-index/completed.svg", getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }))
await Bun.write("docs/topology-validation-index/completed.png", await getPngBufferFromGraphicsObject(graphics, { backgroundColor: "white", pngWidth: 1536, pngHeight: 1536 }))
