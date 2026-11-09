# Source provenance for this review branch

This branch starts at GitHub main `3d7e9d4daa96dda55ae4f3c61850824c2bef7dc0`. The deployed Sites v10 source was `c5d4d14f5222911cb90de41c0d2c7bc0f9928749` (policy `2026-11-09.2`). Their available histories have separate roots, so the source import is a content transplant, not a merge or assertion of common ancestry. The first branch commit imports only the runtime, tests, pipeline and manifest changes necessary for that baseline; it does not replace GitHub's asset exclusions or import corpus/model data, Site deployment settings, or all unrelated Sites documentation.

The GitHub and Sites `snapshot/catalog.json` and `snapshot/assets.json` matched when the branch was prepared. `snapshot/semantic/manifest.json` is imported because its format accompanies the source. To reproduce, use the public hash-verified snapshot via `npm run snapshot:download`, then `npm run build && npm test`. For offline tests, copy the downloaded `snapshot/semantic/tokens-*.gz` to the ignored `dist/client/semantic/` after build; production keeps these assets at the configured fixed origin.

Before experiment changes, 1,008/1,008 manifest assets verified and 41/41 tests passed locally. Local measurements are not a claim about the live deployment. The branch does not deploy, modify main, or reconcile the independent histories. Further integration requires review of the differences and asset policies.

## Repeatable branch verification

Check out this branch, run `npm ci`, `npm run snapshot:download -- --check` after downloading the manifest assets, `npm run build`, copy the verified token gzip files to `dist/client/semantic/` for offline execution, and run `npm test`. Run `node experiments/eval-expanded.mjs` for the 16-query presence/filter check; it is not a corpus-wide accuracy benchmark. Run `node --expose-gc --max-old-space-size=256 experiments/cache-concurrency.mjs` and `node --expose-gc --max-old-space-size=256 experiments/concurrent-mixed.mjs` for local probes; they are not Workers memory tests.

The imported baseline commit immediately before the experiment changes permits a comparison against Sites v10. Some historical cycle-to-cycle timing baselines were taken from intermediate, uncommitted local bundles; the recorded JSONL observations are retained, but those exact intermediate sources are not reconstructed by this branch. Their historical before numbers should not be presented as independently reproducible from Git history. Current-code results and the imported Sites baseline can be rerun.
