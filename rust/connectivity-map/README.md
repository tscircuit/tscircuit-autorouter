# Connectivity map construction

Fresh source ports:

- `lib/utils/getConnectivityMapFromSimpleRouteJson.ts` → `src/get_connectivity_map_from_simple_route_json.rs`
- Bundled `circuit-json-to-connectivity-map` `src/ConnectivityMap.ts` constructor/addConnections → `src/connectivity_map.rs`
- `lib/utils/mapLayerNameToZ.ts` mapping → `src/map_layer_name_to_z.rs`

The adapter returns the dependency's actual `ConnectivityMap` instance. Ordered net entries refer to a shared array pool; stale net names retain the same aliases as TypeScript. String IDs preserve UTF-16 values across the binding. Normal construction executes in Rust; a tagged failing group is replayed solely to materialize the dependency's runtime-specific exception. Subsequent public methods remain on the original TypeScript class.

Parity: `TSCIRCUIT_TS_REFERENCE=/path/to/frozen-checkout bun rust/autorouter-bindings/integration/connectivity-construction-parity.ts`.

The input contract is ordinary typed SRJ data and the built-in JavaScript object prototype, including unusual string names such as `constructor`, `toString`, and `__proto__`. It does not emulate arbitrary global accessor/setter monkeypatches that mutate unrelated input during serialization. Writable inherited string aliases are retained; there is no alternate routing backend or error recovery.
