# Two small native agent evaluations

These configs use the public `agent-evals` library and CLI. Each attempt asks native Pi to run Luna in a fresh temporary workspace. The examples do not start the Wedding app, a browser, or a repository checkout.

The greeting task asks Luna for a brief greeting. Its view submits the assistant messages actually recorded by Pi to a Jev **Noul** question: “Agent responded with a greeting”. The judge maps its probability to `pass` at 0.8 or above, `fail` at 0.2 or below, and `unknown` between those thresholds. A live greeting run reads `TYPESAFE_API_KEY` from this repo's `.env.local`. Importing the config, a dry run, and `show` do not need that key.

The file task starts with `notes.txt` containing two lines and asks Luna to add `# Reviewed by Luna` as the first line. Its code grader compares the saved final file artifact with the saved starting artifact. It requires the exact comment and all original bytes unchanged. The grader does not read the current filesystem or call Jev.

Each tiny task explicitly sets limits of 2 minutes, 8 turns, and 40,000 weighted tokens. Edit the task or use CLI overrides to change them; the library defaults remain 30 minutes, 100 turns, and 1,000,000 weighted tokens. The greeting's 0.8/0.2 thresholds illustrate consumer policy and have not been calibrated.

```sh
pnpm build:evals
pnpm evals run --config evals/examples/greeting.config.ts --dry-run
pnpm evals run --config evals/examples/file-comment.config.ts --dry-run

# These two commands start native Luna trials.
pnpm evals run --config evals/examples/greeting.config.ts
pnpm evals run --config evals/examples/file-comment.config.ts --code-only

pnpm evals show RUN_ID
pnpm evals regrade RUN_ID --config evals/examples/greeting.config.ts
pnpm evals regrade RUN_ID --config evals/examples/file-comment.config.ts --code-only
```

The greeting has no agent tools. The file task enables Pi's native `read`, `edit`, and `write` tools; shell access, extensions, skills, prompt templates, and context files are disabled. Both tasks use a private copied Pi profile and temporary workspace, which are removed after the trial. The file example has no OS-enforced filesystem boundary around native file tools, so run it only with the trusted synthetic fixture included here. Recorded trials and grades remain under `.agent-evals/` for inspection and regrading.
