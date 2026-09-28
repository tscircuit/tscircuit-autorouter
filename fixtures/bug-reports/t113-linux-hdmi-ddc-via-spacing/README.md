# T113-S3 HDMI DDC via-spacing reproduction

These fixtures were captured from the automatic Pipeline 9 phase of a
141-component Allwinner T113-S3 Linux board. The board uses four copper layers,
Core fanout components, `routeRemaining={true}`, and no authored routes, vias,
or waypoints.

`t113-linux-hdmi-ddc-via-spacing.srj.json.gz` is the exact Pipeline 9
constructor input:

- 258 connections
- 605 obstacles
- no preloaded traces
- 0.20 mm minimum via-hole-edge to via-hole-edge clearance
- SHA-256 after decompression:
  `dc19c3abc1788919eea83e1fd7318d072776c3445ddb3208ff5885f66f64b11b`

`t113-linux-hdmi-ddc-via-spacing-unrouted.circuit.json.gz` is the matching
Circuit JSON before routing. It contains 141 source components, 141 PCB
components, and no PCB traces or vias. Its SHA-256 after decompression is
`b83ca178c2556cbe3950c4c6fe730c8953417a49fc2702415ad31b6684376ecb`.

Pipeline 9 completes 388 routed traces. During joint DRC repair it moves two
same-net HDMI 1.8 V vias until their drill-edge gap is 0.175690633 mm. The
pipeline's 0.10 mm benchmark DRC accepts that result even though the input
requires 0.20 mm.
