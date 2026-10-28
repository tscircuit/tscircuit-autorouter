Final legalization MIDI correctness check at `a2e6aa535c5a4110b4b999c044847b73039b3425`: all five numerical and preload assertions passed, including the unchanged original full reference DRC requiring zero errors. The prior via89/via97 clearance failure is gone.

The final SVG assertion failed: 3.077% difference against a 1% threshold. The whole test therefore exited 1; six expectations were executed including the failed SVG. No snapshots were updated or assertions removed. Source, test and fixture hashes are unchanged and the immutable clone is clean.

The test completed uncensored under the external 360-second cap. Local elapsed time is a correctness diagnostic, not a performance comparison.
