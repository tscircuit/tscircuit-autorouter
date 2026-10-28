# Final126 public analysis reproduction

The repository-portable verifier was actually reexecuted against the complete raw126-record Actions artifact for source `365b38451f01c734d3f60628dbd6db14760ca4e6`; all records, archive completeness, protocol identity and independent summary reconstruction pass. [Exact execution record](legal-final-result.json) and [compact verification flags](legal-final-verification-summary.json) retain source, run, digests and output identity. This duplicates neither the raw ZIP nor the126-record data.

Download the original raw artifact from [run40772916886](https://github.com/tscircuit/tscircuit-autorouter/actions/runs/40772916886) and check ZIP SHA-256 `8353966223458c787a600c63075879f3a44e18b43a1e448e5663a067cb574e9b`. Choose fresh output directories, then run from the repository root:

```sh
python3 experiments/hd-refinements/analysis/verify_refinement_artifact.py artifact.zip --out /tmp/hd-final-verified --approved-config experiments/hd-refinements/analysis/approved-configs/legal-confirmation.json --digest 8353966223458c787a600c63075879f3a44e18b43a1e448e5663a067cb574e9b --run 40772916886 --head 365b38451f01c734d3f60628dbd6db14760ca4e6
python3 experiments/hd-refinements/analysis/render_refinement_report.py render --profile legal-confirmation --expected-config experiments/hd-refinements/analysis/approved-configs/legal-confirmation.json --artifact-root /tmp/hd-final-verified/artifact --out /tmp/hd-final-rendered
```

The exact independently approved configuration has file SHA-256 `f044b266cbdf1e639662625457ad5d204f6674f1c56342626900ffd328b36ab4`. The rendered report-data archive preserves all11 original renderer files; it does not replace the raw Actions measurement artifact. The final source is measured365, while any later evidence-only documentation head is a distinct commit.
