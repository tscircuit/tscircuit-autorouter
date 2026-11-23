The fanout cleanup is independent of unmerged routing work. The review stack is **main → [#381](https://github.com/tscircuit/fanout-solver/pull/381) (before-only repro) → [#382](https://github.com/tscircuit/fanout-solver/pull/382) (fix)**.

The revised fix uses main's existing `getInitialViaPoint` and track-candidate generator to prefer source-aligned tracks in compact, unguided automatic boundary-only regions. The production change is three files, with 40 additions and 2 deletions. It does not include #379's general fallback, AM3354 fixture/test changes, visualization helper, or export additions.

<!-- RESULTS -->

### Exact baseline and unchanged circuits

All **125 library files** on fanout main `7ed7a8c16db6a9058b716914f889534d706c846a` are byte-identical to the published fanout **0.0.104** source. [main-publication-proof.json](main-publication-proof.json) records that comparison. The already-completed published baseline [45070654984](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/45070654984) is therefore the actual main before-run; a duplicate benchmark is unnecessary.

The paired stack remains tscircuit **0.0.3280**, Core **0.0.2461** (`ce2683b98de40a7d4eaa4dc055ae105096c744d8`), fanout **0.0.104** plus only the reviewed three-file patch, capacity autorouter **0.0.1156**, bus lanes **0.0.65**, and winding **08d8da9d8dbb037eba332e7bfd685063f8805ed4**. Fanout's internal capacity dependency remains **0.0.718**. The revised routing source commit is `8defd8999b77572c2ea5a84c043e20a5fd23b414`; final PR head `c000bad2781ef331f3213cfe71e138b14adbe855` has the identical library tree (`cd3b4f18234158bc3e3218a3c9406b57cc3a25d8`). The repro declares `transformation-matrix` 3.1.0 as a test-only dependency for the native viewport. No routing dependency, version, or release change is made.

The dataset remains the ten uploaded original/spaced full-circuit H616, ButterStick, Glider, i.MX6 and iCE/Pi TSX samples. Archive SHA-256: `1991ad1891a953dcd660818aaceb73f7aa42dbf704e677e635753b9159f7a6b7`. Components, pads, net membership, original geometry and widths/clearances, fixed DDR placement, and through-via/via-in-pad restrictions are preserved. All copper is routed fresh. The ordering stays **fanout → DDR bus lanes → remaining routing**, with the original **256-assignment cap**, **600-second process budget**, preparation handling and **660-second external watchdog**.

### Failure locations and scope of the fix

The observer captures actual fanout constructor inputs, completed layer assignments, original clearance rejection geometry, winding stages and operation times without changing decisions. In nine baseline cases, most rejection checks are conflicts with already accepted copper. Long target-aligned jogs occupy neighboring source channels; preferring tracks through the existing source/via positions can leave those channels available. This changes ordering in the existing analytic search.

Requests with explicit targets, fixed tracks, corner/winding guidance or reservations keep their existing handling. Regions containing local plane drops keep main's candidate order. Candidate validation, bus atomicity and physical via restrictions remain authoritative.

<!-- FAILURE_SUMMARY -->

A separate winding error in the spaced iCE/Pi circuit declares **17.43 mm** of required breakout-edge length against **14.64 mm** exposed. The ordering change does not repair that winding capacity problem. The source-net-aware geometry audit also proves that **seven requested pads in each i.MX6 variant** are enclosed by foreign-pad trace-clearance barriers, with no configured via fitting inside. It finds no such impossibility proof for the other eight circuits. Per-pad proof geometry is retained under [geometry-audit](geometry-audit/).

### Native repro and review

The same actual iCE/Pi region is used in the main-based before-only repro and the fix. All 92 requests, local pads and supplied rules are retained; irrelevant distant obstacles are omitted from the focused fixture. The test renders actual emitted copper through the native SVG renderer. Its second snapshot is a viewport onto the same SVG, using the existing graphics bounds and transform utilities, so crossing traces are clipped rather than omitted. No production visualization code is added.

<!-- REPRO_IMAGES -->

<!-- VALIDATION -->

This report supersedes the current PR's earlier #379-based comparison. The [previous measured stack](../compact-boundary-handoffs/analysis.md) remains archived as a separate experiment; its gain, plane-drop tradeoff and dedicated-via figures are not presented as results of the revised main-based fix.
