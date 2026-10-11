This directory vendors the MIT-licensed native A13 strict f64 search kernel from
`tscircuit/high-density-a01` revision `c6812cebd44b09f29f2fee929837b313b822f2ae`,
the repository's pinned `@tscircuit/high-density-a13` dependency.

`kernel.c`, `SearchInputs.ts`, and the generated module bytes are unchanged.
`NativeA13WasmSearchKernel.ts` is the original `WasmSearchKernel.ts` wrapper with
the exported class and generated-byte import renamed, and its existing exports
and offsets fields made protected for the guarded private worker adapter. Its
ordinary begin method still copies every input at every search. The original MIT
license is retained in `LICENSE`.

The C source SHA256 is
`29d9795af19b90ccdd898a10173f865c47a8a7c452c9004afcbb2e4f5d1a41b7`.
The 4,560-byte checked-in module SHA256 is
`21e29e085112eb141a3bce375a7affb3b7f7ff3c61303bde18fd729b6f981c0d`.
It has no runtime imports. The upstream generation uses LLVM `-O3 -msimd128`
and `-ffp-contract=off`, without fast math. This directory's regeneration script
also explicitly disables fast math, reassociation, reciprocal substitution and
finite-only assumptions, and preserves signed zeros.

Normal Bun/browser builds embed the checked-in module and require no compiler,
external WASM fetch, Node loader, or filesystem read. To regenerate using LLVM:

```sh
NATIVE_A13_SEARCH_WASM_CLANG=/path/to/llvm/clang bun scripts/build-native-a13-search-wasm-kernel.ts
```

Regeneration requires rerunning the private-state oracle. Its disassembled
scalar-address checks deliberately refer to the pinned checked-in binary; if
LLVM changes the data layout those checks must be updated from the new module
and reviewed alongside its new hash.

The opt-in installer preserves the original native constructor, setup, public
backend string, caps, step multiplier, candidate order and validation. It swaps
only the private search kernel after original setup inside an authenticated
default-worker supervisor quantum. Public/direct/custom candidates use native
JavaScript. Once C is active, a violated kernel/lifetime contract throws; it does
not resume a stale JavaScript search.

The private worker adapter reuses uploads only within each original 100-call
supervisor quantum. It uploads viaAllowed once per quantum, the history pair once
per native negotiation round, and an unchanged consecutive immutable heuristic
array once. Connection-dependent trace/via costs and fixed masks are always
uploaded at every original begin; the original C search reset always runs.
Private kernel/quantum identity maps cannot be minted by public flags, and the
original finally clears all reuse markers before any worker await.

The proof fixture contains the original JavaScript search translation with only
an added closure-state accessor. It compares every original call in 69 consumed
SRJ18 001/005 candidate prefixes, including scalar state, all private arrays,
entire allocated heap capacity and stale slots, parent outputs, routing counters
and original supervisor caps. Whole-board HD tests separately compare all native
routes and node-stage counters through four actual workers. These are functional
checks; performance is evaluated only by the full paired Blacksmith harness.
