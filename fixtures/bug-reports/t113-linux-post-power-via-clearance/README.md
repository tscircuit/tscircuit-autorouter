# T113-S3 post-power via-clearance failure

This fixture contains the complete Circuit JSON geometry from the 56-component
T113-S3 Linux board and the exact SimpleRouteJson input passed to Pipeline 9's
sixth autorouting phase. The Circuit JSON keeps all 56 source and PCB
components and all 275 PCB ports. The routing input keeps all 275 obstacles,
the 56 traces emitted by the preceding fanout and local-routing phases, and the
seven global net connections. No component, obstacle, connection, route, or via
was reduced or manually replaced for this regression.

The global route solves, but power-trace expansion moves the V5VIN vias on
`source_net_2_mst0_0` and `source_net_2_mst5_0` to centers only
0.1656427226 mm apart. Their final copper violates the board's via-clearance
rule even though Pipeline 9 merged same-net vias before expansion.

The test renders the captured Circuit JSON with the exact Pipeline 9 copper
before and after post-power cleanup. Its committed PCB SVG places both real
board renders side by side, so the snapshot shows the final expanded routes
changing from one DRC error to a clean result without substituted graphics.

Provenance from the original TSX board and uncached solver-debug capture:

- Circuit JSON SHA-256: `6e4f72f8a9d9a48a35110714d755ae70afa8cb33df41bff2c600127473b7991e`
- Compressed Circuit JSON SHA-256: `61c9b2be10b31f06eeeb57d90ba312cbe181d1726ab0dbfe18517aac95fb7714`
- TSX SHA-256: `3af0861c0c0c9cc577453d7ebbb00da38d20efed8b6e736aa134dbda95848232`
- Normalized SRJ SHA-256: `1565cbf4682d2051206896a10b5be28dd8712421c735c328275f011d88f1ef32`
- Compressed SRJ SHA-256: `997848dd32f831123d1d03506aeb97be6e1484ce1c617408b96903c0898ea5e1`

Run the exact reproduction with:

```sh
bun test tests/bugs/t113-linux-post-power-via-clearance.test.ts --timeout 9999999
```
