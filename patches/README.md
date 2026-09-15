# High-density search optimization

`high-density-a01.patch` applies the A01/A03 via-occupant cache from https://github.com/tscircuit/high-density-a01/pull/121 to the dependency already selected by this repository.

Keeping that dependency version avoids bringing unrelated solver changes into the integration. Bun applies the patch during installation through `patchedDependencies` in `package.json`.

The cache resets for each connection search. Routing limits and clearance checks remain intact.
