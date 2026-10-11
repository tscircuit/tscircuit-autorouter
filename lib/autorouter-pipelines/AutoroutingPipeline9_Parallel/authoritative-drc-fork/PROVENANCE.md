# Authoritative DRC primitive memo

The native sources are extracted from the installed `@tscircuit/checks@0.0.233` source map, SHA-256 `17f9937307c64f702f2e6f347bd0574a33650ccb7fc3a7b774daca7cd9ca02b5`. The MIT notice accompanies this extraction. The manufacturing constants are the exact source embedded in that same bundle.

Only successful geometry predicates and immutable pad-contact ID lists are memoized. Every evaluation retains the native check order, candidate order, fresh physical graph, live logical connectivity queries, and source-trace deduplication.

Ordered full-graph construction follows `circuit-json-to-connectivity-map@0.0.19`, bundled source SHA-256 `ef18082e9a93c3bc3f6eda1f28a64f1a239d1090be7cfe9a67209d130634b585`. Its MIT notice is in `CONNECTIVITY-MAP-LICENSE`. Native net creation/deletion IDs and ordered Set unions are retained; reverse membership indexes replace network scans. Physical and logical graphs are rebuilt on every evaluation, and the original builders remain the default when primitive memoization is absent.

The opt-in via-to-trace checker retains the pinned gap arithmetic, via-major traversal, live connectivity queries, ordered overlap suppression and original marker formula. On descriptor-verified finite plain data with a captured native runtime Proxy inspector, marker geometry is evaluated only when the native checker constructs a potential error. Browser, uninitialized and observable inputs retain the original public checker.
