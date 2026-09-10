# High-density WASM

A typed adapter for the Rust A01/A03 ports. Search state stays in Rust; the existing TS portfolio keeps selecting and stepping candidates. Other high-density engines remain TypeScript.

Build from the repository root (requires the `wasm32-unknown-unknown` Rust target and `wasm-bindgen-cli` 0.2.128):

```sh
npm ci --prefix rust/high-density-wasm --ignore-scripts
npm run build --prefix rust/high-density-wasm
npm test --prefix rust/high-density-wasm
```

Set `WASM_BINDGEN` to use a specific CLI executable. Generated bindings and adapter output are ignored by Git.

Opt into both Rust modules:

```sh
./benchmark.sh --dataset srj18 --tiny-hypergraph-backend wasm --high-density-backend wasm --concurrency 4
```

Both backends default to TypeScript independently. The worker initializes WASM before timing the solve.

For direct use, call `initializeHighDensityWasm({ module_or_path: wasmBytes })`, then construct `new WasmHighDensitySolver("a01", props)` (or `"a03"`). The adapter exposes the usual `setup`, `step`, `solve`, `getOutput`, and `visualize` methods. Call `dispose()` when finished; disposed instances reject further operations.

Whole-board parity (isolated processes keep global route caches independent):

```sh
bun rust/high-density-wasm/integration/parity.ts 16
```

A03 calls the host `Math.hypot` for identical floating-point rounding and heap ordering across JS runtimes. Engine parity tests run under both Node and Bun.
