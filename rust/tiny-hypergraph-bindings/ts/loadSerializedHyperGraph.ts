import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph as rustLoadSerializedHyperGraph } from "../pkg/tiny_hypergraph_bindings.js"
import { assertTinyHypergraphBindingsInitialized } from "./loadTinyHypergraphBindings.js"
import { encodeJsonInput, decodeUndefinedJsonOutput } from "./jsonWire.js"
import type { LoadedHyperGraph } from "./types.js"

/** Converts serialized IDs, geometry, and existing assignments into solver input. */
export function loadSerializedHyperGraph(
  graph: SerializedHyperGraph,
): LoadedHyperGraph {
  assertTinyHypergraphBindingsInitialized()
  const loaded = decodeUndefinedJsonOutput(rustLoadSerializedHyperGraph(encodeJsonInput(graph)))
  return loaded
}
