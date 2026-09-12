import { encodeJsonInput, decodeJsonOutput } from "./jsonWire.js"
import { orderConnectionIndexesByNetCardinality } from "../pkg/tiny_hypergraph_bindings.js"
import { assertTinyHypergraphBindingsInitialized } from "./loadTinyHypergraphBindings.js"

export function orderConnectionsByNetCardinality<T>(
  connections: T[],
  getNetId: (connection: T) => string,
): T[] {
  assertTinyHypergraphBindingsInitialized()
  const indexes = decodeJsonOutput(orderConnectionIndexesByNetCardinality(encodeJsonInput(connections.map(getNetId))))
  return indexes.map((index) => connections[index]!)
}
