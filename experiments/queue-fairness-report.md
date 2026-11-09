# Queue fairness, cancellation and source audit

## Scope

Baseline is branch commit `7119ea2cacad71650344353f6bdf0a7b2137f885`; candidate adds a 15-second best-effort timer to each queued retrieval operation. Experiments ran only in local Wrangler 4.158.0 / workerd 2026-11-04 with compatibility date 2026-11-07 and hash-verified local corpus. No production calls or deployment. The timer limits waiting to start, not running execution, and may fire late if the event loop is busy. A never-settling active operation can still occupy the gate until the runtime recovers or restarts. The cap is per isolate, counts operations rather than bytes, and does not cover direct page reads or other isolates.

## Fairness and congestion

The one-active/24-queued FIFO gate retains order of admitted *operations*, not guaranteed end-to-end request completion order: a request has separate search and evidence stages, cached results bypass the gate, coalesced requests share work and network arrival order may differ. Unit tests verify FIFO, timer expiry removal, no permit theft, all 24 waiting entries timing out, overflow and recovery after error. New arrivals do not bypass already queued operations when work is uncached. Client cancellation does not yet remove queued work.

Three alternating fresh-worker trials issued eight distinct queries concurrently, then repeated them (`queue-deadline-trials.jsonl`). Median first-batch wall time was 1,315.64ms baseline versus 1,300.23ms candidate; median individual first-batch time across 24 results was 1,250.15ms versus 1,266.05ms. No errors; evidence hashes matched 24/24 first and 24/24 repeated responses. Sample size is too small to establish a performance improvement or tail-latency distribution. Response completion order differed from client dispatch order, so these results do not establish request-level FIFO.

A fresh local candidate received 40 distinct year-filtered requests: 26 completed, 14 returned the explicit queue-full retry error; no other errors or returned-year mismatches (`queue-overload-after.jsonl`). Arrival timing affects the split. Empty results do not mean absent budgets.

## Waiting deadline and error recovery

In a test-only wrapper, one asset read was delayed 17 seconds; two distinct user calls were submitted 300ms apart (`queue-timeout-final.jsonl`). In this one local baseline trial workerd returned HTTP 500 hung-request errors for both calls and for the immediate follow-up. In the candidate trial, the queued call received an MCP retry error in about 15.03s, the first call completed in about 17.28s, and a subsequent different query completed in about 0.19s. This is a deliberately injected local failure and not proof that production failures or all hangs recover. A previously captured diagnostic is omitted because it contained machine-local stack paths; the final record preserves the first error line only.

Three paired cancellation probes aborted four of eight client fetches in a shared-query batch and four of eight in a distinct-query batch, after 100ms (`queue-cancellation-trials.jsonl`). In every run the remaining four shared calls returned identical evidence, the remaining distinct calls returned the requested years, and a later 2025 query succeeded. Client abort is not evidence that the server removed queued work. The deployment compatibility date predates default incoming Request.signal support, and this branch neither enables `enable_request_signal` nor passes a cancellation signal through coalesced work. See https://developers.cloudflare.com/workers/configuration/compatibility-flags/ . A shared operation must not be cancelled merely because one of multiple waiting clients disconnects; subscriber-aware cancellation and hosted behavior remain unimplemented/unverified.

## Official-source cross-checks

`source-crosscheck.mjs` and `source-crosscheck.jsonl` exercise both `budget_research` and `get_budget_page`; source IDs, hashes, metadata and page text were checked against downloaded official PDFs, rendered with PDFKit, not committed to Git.

- 2025 본예산 주택과 자본적위탁사업비: https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2025/11599_3_14.pdf , PDF page 8, SHA-256 `b38d9e1e893f4de36d8f48c77209418ccd7ef3e0b3bea146f0a92ac57a609ec8`; table header unit 천원, `403-02` row 220,000; the calculation text separately shows 220,000,000원.
- 2026년 1회 추경 판교 연구센터: https://www.seongnam.go.kr/humanframe/file/sncity/bgt/2026/11610_1_3.pdf , PDF page 21, SHA-256 `c04dda0c0d3f6165873e3e496c7e885dbd3ab6488da5e0295e434b223ce427ea`; AI반도체과, `401-01`, table unit 천원, 26,299,000. Budget, previous amount and difference are distinct columns. These two audited examples do not establish whole-corpus accuracy.

## Reproduction

Use `npm ci`, the snapshot manifest download, `npm run build`, and copy verified token gzip files to ignored `dist/client/semantic/` for offline tests. Prepare `work/cycle-baseline-src` from `git archive 7119ea2`, with the same ignored assets and dependencies, and build it. Install Wrangler in ignored `work/worker-tools` as in `workerd-report.md`. Run `BASE_CONFIG="$PWD/work/cycle-baseline-src/dist/server/wrangler.json" node experiments/run-workerd-trials.mjs` for the 3 paired throughput runs, and set `PROBE_SCRIPT=experiments/workerd-cancellation-probe.mjs` for abort observations. `node experiments/prepare-gate-probe.mjs` creates temporary bundled wrappers and configs in ignored build/work paths; run the runner once with `BASE_CONFIG`/`GATED_CONFIG` set to those configs and `PROBE_SCRIPT=experiments/workerd-timeout-probe.mjs`. All Wrangler operations are local and need loopback permission. `node experiments/source-crosscheck.mjs`, `npm run test:unit` and `npm test` run local checks. A build can regenerate the compressed rank file; restore the original manifest-matching gzip before rechecking snapshot hashes.
