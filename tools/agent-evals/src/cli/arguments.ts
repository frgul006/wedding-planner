import { parseArgs } from 'node:util';

const options = {
  help: { type: 'boolean' },
  json: { type: 'boolean' },
  task: { type: 'string' },
  variant: { type: 'string' },
  profile: { type: 'string' },
  'grader-env-file': { type: 'string' },
  'no-grader': { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  semantic: { type: 'boolean' },
  'grader-model': { type: 'string' },
  'grader-input-price': { type: 'string' },
  'grader-output-price': { type: 'string' },
  'budget-usd': { type: 'string' },
  'retry-of': { type: 'string' },
  grades: { type: 'string' },
  limit: { type: 'string' },
} as const;

const profileFlags = [
  'profile',
  'budget-usd',
  'grader-model',
  'grader-input-price',
  'grader-output-price',
];
const commandFlags = {
  help: [],
  tasks: [],
  profiles: [],
  validate: [],
  runs: ['limit'],
  show: ['grades'],
  compare: ['grades'],
  doctor: [...profileFlags, 'grader-env-file', 'no-grader'],
  run: [...profileFlags, 'task', 'variant', 'grader-env-file', 'no-grader', 'dry-run', 'retry-of'],
  regrade: [...profileFlags, 'semantic', 'grader-env-file'],
  'grader-smoke': [...profileFlags, 'grader-env-file'],
} as const;

export type Command = keyof typeof commandFlags;
export interface CliRequest {
  command: Command;
  args: string[];
  values: ReturnType<typeof parseOptions>['values'];
  helpTopic?: Command;
}

function parseOptions(args: string[]) {
  return parseArgs({ args, options, allowPositionals: true, tokens: true });
}

export function parseCommand(argv: string[]): CliRequest {
  const parsed = parseOptions(argv);
  const name = parsed.positionals[0] ?? 'help';
  const commandName = name === 'smoke' ? 'run' : name;
  if (!Object.hasOwn(commandFlags, commandName))
    throw new Error(`Unknown command "${name}". Run pnpm evals --help.`);
  const command = commandName as Command;
  const args = parsed.positionals.slice(1);
  if (parsed.values.help)
    return { command: 'help', args: [], values: parsed.values, helpTopic: command };
  if (command === 'help') {
    if (
      args.length > 1 ||
      (args[0] && !Object.hasOwn(commandFlags, args[0]) && args[0] !== 'smoke')
    ) {
      throw new Error('Use pnpm evals help <command>, for example pnpm evals help run.');
    }
    return {
      command,
      args: [],
      values: parsed.values,
      helpTopic: args[0] === 'smoke' ? 'run' : (args[0] as Command | undefined),
    };
  }
  const allowed = new Set<string>(['json', 'help', ...commandFlags[command]]);
  for (const token of parsed.tokens) {
    if (token.kind === 'option' && !allowed.has(token.name)) {
      throw new Error(`--${token.name} does not apply to ${name}. Run pnpm evals help ${command}.`);
    }
  }
  const maximum = command === 'compare' ? 2 : ['run', 'show', 'regrade'].includes(command) ? 1 : 0;
  if (args.length > maximum || (command === 'compare' && args.length !== 2)) {
    throw new Error(
      command === 'compare'
        ? 'Compare needs two trial IDs or paths: pnpm evals compare <enabled-run> <disabled-run>'
        : `Unexpected arguments for ${name}. Run pnpm evals help ${command}.`,
    );
  }
  if (command === 'run' && args[0] && parsed.values.task)
    throw new Error('Choose a task with either run <task> or --task, not both.');
  if (parsed.values.variant && !['enabled', 'disabled'].includes(parsed.values.variant)) {
    throw new Error('--variant must be enabled or disabled.');
  }
  if (
    parsed.values.limit !== undefined &&
    (!/^\d+$/.test(parsed.values.limit) ||
      Number(parsed.values.limit) < 1 ||
      Number(parsed.values.limit) > 1_000)
  ) {
    throw new Error('--limit must be a whole number between 1 and 1000.');
  }
  if (
    command === 'compare' &&
    parsed.values.grades &&
    !['latest', 'original'].includes(parsed.values.grades)
  ) {
    throw new Error(
      'Compare accepts --grades latest or original. Use show --grades REVISION to inspect an individual historical regrade.',
    );
  }
  if (command === 'regrade' && !parsed.values.semantic) {
    const paidFlags = [
      'profile',
      'budget-usd',
      'grader-model',
      'grader-input-price',
      'grader-output-price',
      'grader-env-file',
    ];
    if (parsed.tokens.some((token) => token.kind === 'option' && paidFlags.includes(token.name))) {
      throw new Error(
        'Grader/profile options on regrade require --semantic. An ordinary regrade is entirely offline.',
      );
    }
  }
  return { command, args, values: parsed.values };
}

const topicHelp: Partial<Record<Command, string>> = {
  tasks: `List available task definitions (offline)

  pnpm evals tasks
  pnpm --silent evals tasks --json

Tasks are discovered from evals/tasks/*.json. See evals/authoring.md to add one.
Preview a task with pnpm evals run TASK --dry-run.
`,
  profiles: `Inspect runtime and API cost profiles (offline)

  pnpm evals profiles

Profiles are discovered from evals/profiles/*.json. Select the filename without
.json using --profile NAME on run, doctor, grader-smoke or regrade --semantic.
`,
  validate: `Validate all task and profile files (offline)

  pnpm evals validate

Checks JSON schemas, task targets and referenced rubrics without starting Pi,
a browser or an API call. Use doctor afterward to check local runtime prerequisites.
`,
  runs: `List saved trials (offline)

  pnpm evals runs
  pnpm evals runs --limit 5

Options
  --limit NUMBER              Number of recent trials, from 1 to 1000 (default: 10)

Trials appear newest first. Diagnostic and comparison folders are excluded.
Inspect a result with pnpm evals show latest or pnpm evals show RUN_ID.
`,
  run: `Run one native Pi trial

  pnpm evals run ui-copy
  pnpm evals run docs-only --no-grader
  pnpm evals run ui-copy --variant disabled --dry-run

Options
  --variant enabled|disabled   Whether the browser instruction is present (default: enabled)
  --profile NAME               A JSON profile from evals/profiles (default: smoke)
  --no-grader                  Skip the separately billed semantic grader
  --dry-run                    Validate and preview locally; no Pi, API or browser calls
  --retry-of RUN               Link a manual retry; preserve the original failure

smoke --task NAME remains an alias for run NAME.
Ctrl-C requests cancellation, cleanup and preservation of a started trial's evidence.
`,
  'grader-smoke': `Check the semantic grader with one bounded API call

  pnpm evals grader-smoke
  pnpm evals grader-smoke --profile smoke --budget-usd 0.01

Options
  --profile NAME              A JSON profile from evals/profiles (default: smoke)

Uses authored evidence without running Pi or a browser. Verifies structured output
and citations; human calibration remains a separate review step.
`,
  regrade: `Regrade saved evidence without rerunning Pi

  pnpm evals regrade latest
  pnpm evals regrade <run-id-or-path>
  pnpm evals regrade latest --semantic --budget-usd 0.01

Default: offline deterministic grading. --semantic adds one bounded API call.
Each revision is saved separately; original grades and evidence remain intact.
`,
  compare: `Compare a matched enabled/disabled pair (offline)

  pnpm evals compare <enabled-run> <disabled-run>
  pnpm evals compare <enabled-run> <disabled-run> --grades original

--grades latest|original chooses a whole grading revision on each side (default: latest).
Mismatched task, runtime, model, budget, resources or grading criteria are explained.
A single pair cannot establish whether an instruction is useful.
`,
  show: `Inspect a saved trial (offline)

  pnpm evals show latest
  pnpm evals show <run-id-or-path> --grades original
  pnpm evals show <run-id-or-path> --grades regrade-TIMESTAMP

Options
  --grades latest|original|REVISION   A whole grading revision (default: latest)

Shows execution status, chosen grades, grading history, costs and evidence paths.
Copy a revision ID from grading history. An invalid latest revision is reported;
use --grades original to inspect the original or regrade to create a new revision.
`,
  doctor: `Check local prerequisites and native Pi settings

  pnpm evals doctor --no-grader
  pnpm evals doctor

Options
  --profile NAME              A JSON profile from evals/profiles (default: smoke)
  --no-grader                 Skip grader key/model checks

No agent prompt or billed generation is sent. The default also checks API key/model access.
Use --no-grader when running only Pi on its subscription.
`,
};

export function helpText(topic?: Command): string {
  const shared = `Saved-run references accept a run ID, latest, or a path relative to where you invoked pnpm.
--json gives machine-readable output; progress stays off stdout.
`;
  const paid = `
Direct API options (run, doctor, grader-smoke, regrade --semantic)
  --grader-env-file PATH       Default: original checkout's .env.evals.local
  --budget-usd AMOUNT          API admission estimate, at most $1 per invocation
  --grader-model ID            No automatic model fallback
  --grader-input-price RATE    USD per million tokens; required with a different model
  --grader-output-price RATE   USD per million tokens; required with a different model
`;
  if (topic && topicHelp[topic])
    return `${topicHelp[topic]}
${shared}${['run', 'doctor', 'regrade', 'grader-smoke'].includes(topic) ? paid : ''}`;
  return `Agent evaluations

Start here
  pnpm evals tasks                         Explore available tasks (offline)
  pnpm evals validate                      Check task/profile files (offline)
  pnpm evals doctor --no-grader             Check local Pi and browser prerequisites
  pnpm evals run ui-copy --dry-run          Preview configuration and cost bounds
  pnpm evals run ui-copy                    Run Pi + one cheap API grader

Explore results (offline)
  pnpm evals runs                          List recent trials
  pnpm evals show latest                   Read results and grading history
  pnpm evals regrade latest                Apply current deterministic graders
  pnpm evals compare ENABLED DISABLED      Inspect a controlled pair

Also available
  profiles       List runtime and cost profiles
  grader-smoke   One tightly bounded paid structured-output check
  help COMMAND   Detailed options and examples

${shared}
Pi retains its own authentication/model. Subscription Pi is bounded by tokens/time;
the API allowance covers direct API/AI SDK calls. Live runs are always explicit.
`;
}
