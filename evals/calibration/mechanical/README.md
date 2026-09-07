# Native browser command pair regression

`native-browser-pair.json` is a minimized trace from the synthetic UI smoke trial of 7 September 2026. It preserves the successful target edit, agent-issued native `playwright-cli open && playwright-cli snapshot` command, sandbox command receipt, output, and independently collected final target/snapshot artifacts. It omits model messages and authentication metadata and replaces tool-call identifiers, event identifiers, timestamps, and the browser process ID.

The trial later reached its token limit. Browser behavior was nevertheless observed successfully before interruption. Grader 1.0.0 conservatively returned unknown for all shell compounds. Grader 1.1.0 supports this exact literal two-command sequence when the trusted sandbox receipt proves success, both native page URLs match the changed local flow, the explicit inline snapshot equals the captured artifact, and the final target hash matches the observed edit and browser receipt. An automatic navigation snapshot alone does not qualify.

This is an offline mechanical regression fixture, not a model-based calibration judgment or evidence that the instruction is generally effective. Its expectations are exercised in `tools/agent-evals/test/deterministic-graders.test.ts`.
