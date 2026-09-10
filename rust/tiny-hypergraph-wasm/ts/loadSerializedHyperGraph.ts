import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph as rustLoadSerializedHyperGraph } from "../pkg/tiny_hypergraph_wasm.js"
import { assertTinyHypergraphWasmInitialized } from "./initTinyHypergraphWasm.js"
import type { LoadedHyperGraph } from "./types.js"

/** Converts serialized IDs, geometry, and existing assignments into solver input. */
export function loadSerializedHyperGraph(
  graph: SerializedHyperGraph,
): LoadedHyperGraph {
  assertTinyHypergraphWasmInitialized()
  const loaded = rustLoadSerializedHyperGraph(graph) as LoadedHyperGraph
  return loaded
}
