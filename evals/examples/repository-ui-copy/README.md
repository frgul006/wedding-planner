# Actual repository trial evidence

These agent-reviewed extracts come from the completed instruction-enabled `repository-ui-copy` v2 trial on September 16. The agent ran against Wedding commit `30d2388f71595d1ba65d0d2fabc8b97b6ee48f80` and changed the real login component.

- [enabled.patch](enabled.patch) is the complete retained source patch: the idle submit label changed from “Sign in” to “Sign in to manage the wedding”. Its bytes match the evaluator's saved patch.
- [enabled-snapshot.yaml](enabled-snapshot.yaml) is the exact explicit snapshot YAML retained inline in the successful native `playwright-cli` tool result. It displays the changed button. A matching workspace snapshot file is absent from the final artifacts; this is the retained inline field, not a recovered snapshot file.
- [enabled-evidence.json](enabled-evidence.json) records the passing browser judgment, attributed receipt facts, event sequence numbers, before/final target hashes, exported-file hashes, independent-check statuses and verified private-recording integrity fingerprint.

The final target edit completed at `e00466`. The agent then started the literal `playwright-cli open … && playwright-cli snapshot` command at `e00661`; successful completion at `e00665` retained the explicit YAML. Both reported page URLs matched `/admin/login`. The target hashes at browser execution matched the evaluator's final source hash. Browser grader v1.6.0 cited those observations and passed. Independent evaluator lint, production build, browser acceptance and source-stability checks also passed; they are distinct from the agent's browser evidence.

Only receipt URLs and the command's loopback origin are replaced with the explicitly labeled `<LOCAL_ORIGIN>` placeholder. Patch and snapshot bytes are unchanged, including the snapshot's lack of a trailing newline. Prompts, instructions, arbitrary transcript text, private paths and credentials are omitted. The retained integrity fingerprint identifies the verified private recording; these partial extracts cannot independently replay or verify its entire contents.

This is an observation from one actual agent trial, not evidence that the instruction is useful or unnecessary. The isolated runtime uses webpack and an unavailable local authentication endpoint. Successful sign-in, database workflows, full personal Pi-extension parity and semantic-grader accuracy are outside this result.

## Matched instruction pair

The pair completed with matching comparison conditions on the frozen evaluator implementation in commit `a0e1b7b`. Both trials used task version 2 and the same saved Pi model/runtime and bounds.

| Instruction | Task outcome | Independent checks | Change scope | Browser behavior  | Browser compliance | Semantic grade |
| ----------- | ------------ | ------------------ | ------------ | ----------------- | ------------------ | -------------- |
| Enabled     | Pass         | Pass               | Pass         | Pass              | Pass               | Pass           |
| Disabled    | Pass         | Pass               | Pass         | Fail: no snapshot | Not applicable     | Pass           |

The disabled trial also updated the corresponding test locators; its complete retained change is in [disabled.patch](disabled.patch). Both agent executions completed. Missing browser validation is the disabled condition's observed behavior, not a failed obligation when that instruction is absent.

The generated [pair review](pair-review/report.md) contains both results, attributed receipt facts and integrity hashes. Its two Luna calls cost an estimated **$0.0013672** using the configured uncached input rates, against an aggregate reservation of $0.00912 and allowance of $0.02. Pi used the existing subscription; provider catalog dollar estimates are not direct API charges.

This one pair exercises the workflow and records a behavioral difference. It does not establish reliability or instruction usefulness.
