import { readFile } from "node:fs/promises"
import init, { RustTinyHyperGraphSolver } from "../pkg/tiny_hypergraph_wasm.js"

const bytes = await readFile(new URL("../pkg/tiny_hypergraph_wasm_bg.wasm", import.meta.url))
await init({ module_or_path: bytes })

export { RustTinyHyperGraphSolver }

export { createInput } from "./fixture.mjs"
