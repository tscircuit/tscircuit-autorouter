# T113-S3 USB and UART routing-region failure

This fixture contains the complete unrouted Circuit JSON geometry and all ten
SimpleRouteJson inputs captured from the 86-component T113-S3 Linux board after
USB-C and UART were added. It keeps all 86 source components, all 86 PCB
components, all 373 routing obstacles, and the 110 traces emitted by the real
fanout stages before the global phase. No component, obstacle, connection,
route, or via was reduced, redrawn, or manually substituted.

The local fanout inputs use search-region bounds rather than manufactured board
edges. Treating those bounds as a board outline creates false clearance errors.
The global phase also arrives with preloaded fanout copper, which previously
disabled clearance precision repair. When that guard is removed, choosing only
the best indexed force candidate can still stop on a route that introduces a
different reference-DRC error.

The test solves the captured local SoC and global Pipeline 9 phases and checks
both with the reference DRC. Its committed PCB SVG snapshot places the exact
unrouted Circuit JSON on the left and the same circuit plus the actual solver
output on the right.

Provenance from the TSX board and uncached phase capture:

- TSX SHA-256: `bd93b60eb35b0dd52727d4c28f254d015b49dc65871252d07dd6c50a57792fe9`
- Fully routed Circuit JSON SHA-256: `5994776d69f92e980b644e8a151db45c08db84d3ce304e01218ee5ae951c7630`
- Unrouted Circuit JSON SHA-256: `7eaa510e716ee254c975732f09cda4ab96b5d3293074c6370ad6ad7a1feddcbf`
- Compressed unrouted Circuit JSON SHA-256: `310ec448b91c572d47c284c872197553e56caf5f2706234a0737564f088856d3`
- Phase capture SHA-256: `46f88d4b786a932e0fe732b5be1b217e26ee20362551d9e036fab100e80423c6`
- Compressed phase capture SHA-256: `d2e0bc1cca82f6d5a37df9a215f59a54a8f9dceb509a1a4d514bc0e4e71fc86c`

Run the exact reproduction with:

```sh
BUN_UPDATE_SNAPSHOTS=1 bun test --timeout 9999999 tests/bugs/t113-linux-usb-uart-routing-region.test.ts
```
