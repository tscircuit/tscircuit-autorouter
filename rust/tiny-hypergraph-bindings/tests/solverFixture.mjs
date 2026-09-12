import { readFile } from "node:fs/promises"
import init, { TinyHyperGraphSolver } from "../pkg/tiny_hypergraph_bindings.js"

const bytes = await readFile(new URL("../pkg/tiny_hypergraph_bindings_bg.wasm", import.meta.url))
await init({ module_or_path: bytes })

export { TinyHyperGraphSolver }

export { createInput } from "./fixture.mjs"
