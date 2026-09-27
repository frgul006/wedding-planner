export const nonVerifyingArgument =
  /^(?:-[hv]|--(?:help|version|list(?:Tests)?|watch|passWithNoTests|dry-run))(?:=|$)/i;

/** A literal subset of shell words; this parser never evaluates or executes text. */

function literalCommands(command: string, candidatesOnly = false): string[][] | undefined {
  if (!candidatesOnly && /[$`\\]/.test(command)) {
    return;
  }
  for (const character of command) {
    const code = character.charCodeAt(0);
    if (
      !candidatesOnly &&
      (code < 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029)
    ) {
      return;
    }
  }
  const commands: string[][] = [];
  let words: string[] = [];
  let word = '';
  let started = false;
  let quote: "'" | '"' | undefined;
  const finishWord = () => {
    if (started) {
      words.push(word);
    }
    word = '';
    started = false;
  };
  for (let index = 0; index < command.length; index++) {
    const character = command[index]!;
    if (candidatesOnly && character === '\\' && quote !== "'") {
      const next = command[++index];
      if (next !== undefined && next !== '\n') {
        word += next;
        started = true;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = undefined;
      } else {
        word += character;
      }
      continue;
    }
    if (candidatesOnly && character === '#' && !started) {
      const newline = command.indexOf('\n', index);
      if (newline === -1) {
        break;
      }
      index = newline - 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
    } else if (candidatesOnly && ';|&()\r\n'.includes(character)) {
      finishWord();
      if (words.length) {
        commands.push(words);
      }
      words = [];
    } else if (character === ' ' || (candidatesOnly && character === '\t')) {
      finishWord();
    } else if (character === '&' && command[index + 1] === '&') {
      finishWord();
      if (!words.length) {
        return;
      }
      commands.push(words);
      words = [];
      index++;
    } else {
      // Outside quotes, shell operators, comments, globs and expansions are unsupported.
      if (!candidatesOnly && ';&|<>#*?[]{}()~!^'.includes(character)) {
        return;
      }
      word += character;
      started = true;
    }
  }
  if (quote && !candidatesOnly) {
    return;
  }
  finishWord();
  if (!words.length && !candidatesOnly) {
    return;
  }
  if (words.length) {
    commands.push(words);
  }
  return commands;
}

function unwrapInvocation(words: string[]): string[] | undefined {
  let tokens = [...words];
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0] ?? '')) {
    tokens.shift();
  }
  // Recognize a few ordinary wrappers only to preserve uncertainty, never credit.
  for (let wrappers = 0; wrappers < 8; wrappers++) {
    const name = tokens[0];
    if (name === 'env') {
      tokens.shift();
      while (tokens.length) {
        if (
          /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]!) ||
          ['-i', '--ignore-environment', '--'].includes(tokens[0]!)
        ) {
          tokens.shift();
        } else if (['-u', '--unset'].includes(tokens[0]!)) {
          tokens.splice(0, 2);
        } else if (tokens[0]!.startsWith('--unset=')) {
          tokens.shift();
        } else {
          break;
        }
      }
    } else if (name === 'command') {
      tokens.shift();
      if (tokens[0] === '-v' || tokens[0] === '-V') {
        return;
      }
      if (tokens[0] === '-p') {
        tokens.shift();
      }
      if (tokens[0] === '--') {
        tokens.shift();
      }
    } else if (name === 'exec' || name === 'nohup' || name === 'builtin') {
      tokens.shift();
      if (tokens[0] === '--') {
        tokens.shift();
      }
    } else if (name === 'timeout' && /^\d+(?:\.\d+)?[smhd]?$/.test(tokens[1] ?? '')) {
      tokens = tokens.slice(2);
    } else {
      break;
    }
  }
  return tokens;
}

function candidateInvocation(words: string[]): boolean {
  const tokens = unwrapInvocation(words);
  if (!tokens) {
    return false;
  }
  const [executable, ...args] = tokens;
  const name = executable?.split('/').at(-1);
  if (
    (name === 'npx' || (['pnpm', 'npm'].includes(name ?? '') && args[0] === 'exec')) &&
    args.includes('playwright-cli')
  ) {
    return candidateInvocation(args.slice(args.indexOf('playwright-cli')));
  }
  if (['bash', 'sh', 'zsh', 'eval'].includes(name ?? '')) {
    return args.some((arg) => /\bplaywright-cli\b/.test(arg) && /\bsnapshot\b/.test(arg));
  }
  if (name === 'playwright-cli') {
    if (args.some((arg) => /^(?:--help|--version|-h|-v)$/.test(arg))) {
      return false;
    }
    if (/^(?:-s|--session)=/.test(args[0] ?? '')) {
      args.shift();
    } else if (args[0] === '-s' || args[0] === '--session') {
      args.splice(0, 2);
    }
    // A fill value named "snapshot" is data, not a browser action.
    const action = args.find((arg) =>
      ['open', 'goto', 'fill', 'click', 'snapshot', 'close'].includes(arg),
    );
    return action === 'snapshot';
  }
  return (
    ['pnpm', 'npm', 'npx', 'vitest', 'jest'].includes(name ?? '') &&
    (name === 'vitest' ||
      name === 'jest' ||
      args.some((arg) => /^(?:test(?::[\w-]+)?|lint|build|vitest|jest)$/.test(arg)))
  );
}

function hasVerificationSubstitution(command: string): boolean {
  let quote: "'" | '"' | undefined;
  let substitution = false;
  for (let index = 0; index < command.length; index++) {
    const character = command[index];
    if (character === '\\' && quote !== "'") {
      index++;
      continue;
    }
    if (quote === "'") {
      if (character === "'") {
        quote = undefined;
      }
      continue;
    }
    if (!quote && character === '#' && (index === 0 || /\s/.test(command[index - 1]!))) {
      const newline = command.indexOf('\n', index);
      if (newline === -1) {
        break;
      }
      index = newline;
      continue;
    }
    if (character === '`' || (character === '$' && command[index + 1] === '(')) {
      substitution = true;
    }
    if (character === '"') {
      quote = quote === '"' ? undefined : '"';
    } else if (!quote && character === "'") {
      quote = "'";
    }
  }
  // Substitution is deliberately not interpreted. A potentially invoked browser
  // check remains unknown, matching the legacy ambiguity detector's policy.
  return substitution && /\bplaywright-cli\b/.test(command) && /\bsnapshot\b/.test(command);
}

type VerificationKind = 'test' | 'lint' | 'build' | 'browser_snapshot';

/** Potential verification plus any provable categories; this never grants execution credit. */

export function classifyVerificationCommand(
  command: string,
): { checkKinds?: VerificationKind[] } | undefined {
  const commands = literalCommands(command);
  const candidates = commands ?? literalCommands(command, true) ?? [];
  if (
    !candidates.some(candidateInvocation) &&
    !hasVerificationSubstitution(command) &&
    !(
      /^(?:pnpm|npm|npx|bash|sh|zsh|playwright-cli)\b/.test(command.trim()) &&
      /\b(?:test|lint|build|snapshot|vitest|jest)\b/.test(command)
    )
  ) {
    return;
  }
  // Ambiguous shell syntax may affect every required check.
  if (!commands) {
    return {};
  }
  if (browserCommandChain(commands, 'classify')) {
    return { checkKinds: ['browser_snapshot'] };
  }
  const kinds = new Set<VerificationKind>();
  for (const words of commands) {
    const tokens = unwrapInvocation(words);
    if (!tokens?.length) {
      return {};
    }
    let name: string | undefined = tokens[0];
    const args = tokens.slice(1);
    // Package executors keep the invoked program in a literal command position.
    const packageExecutor =
      name === 'npx' || (['pnpm', 'npm'].includes(name!) && args[0] === 'exec');
    if (packageExecutor) {
      if (name !== 'npx') {
        args.shift();
      }
      name = args.shift();
    }
    if (
      !packageExecutor &&
      ['echo', 'printf', 'sleep', 'cd', 'true', 'false'].includes(name ?? '')
    ) {
      continue;
    }
    if (name === 'playwright' && args[0] === 'test') {
      kinds.add('test');
    } else if (name === 'vitest' || name === 'jest') {
      kinds.add('test');
    } else if (name === 'pnpm' || name === 'npm') {
      if (args[0] === 'run') {
        args.shift();
      }
      if (/^test(?::[\w-]+)?$/.test(args[0] ?? '')) {
        kinds.add('test');
      } else if (args[0] === 'lint' || args[0] === 'build') {
        kinds.add(args[0]);
      } else {
        return {};
      }
    } else if (name === 'playwright-cli') {
      if (/^(?:-s|--session)=/.test(args[0] ?? '')) {
        args.shift();
      } else if (args[0] === '-s' || args[0] === '--session') {
        args.splice(0, 2);
      }
      if (args.length === 1 && args[0] === 'snapshot') {
        kinds.add('browser_snapshot');
      } else {
        return {};
      }
    } else {
      return {};
    }
  }
  return { checkKinds: [...kinds] };
}

function isHttpUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Recognize an && chain of literal browser actions and sleeps with one final
 * explicit snapshot. Recognition alone does not establish execution or evidence.
 */

export function isBrowserSnapshotChain(command: string): boolean {
  const commands = literalCommands(command);
  return commands !== undefined && browserCommandChain(commands, 'credit');
}

/** Credit requires a final snapshot; classification only bounds what a literal chain could affect. */
function browserCommandChain(commands: string[][], mode: 'credit' | 'classify'): boolean {
  if (mode === 'credit' && commands.length < 2) {
    return false;
  }
  let session: string | null | undefined;
  let sawSnapshot = false;
  for (const [index, words] of commands.entries()) {
    const [executable, ...tokens] = words;
    if (executable === 'sleep') {
      const seconds = tokens[0];
      if (
        (mode === 'credit' && index === commands.length - 1) ||
        tokens.length !== 1 ||
        !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(seconds!) ||
        !Number.isFinite(Number(seconds))
      ) {
        return false;
      }
      continue;
    }
    if (executable !== 'playwright-cli') {
      return false;
    }
    let commandSession: string | null = null;
    if (/^(?:-s|--session)=/.test(tokens[0] ?? '')) {
      commandSession = tokens.shift()!.split('=').slice(1).join('=');
    } else if (tokens[0] === '-s' || tokens[0] === '--session') {
      tokens.shift();
      commandSession = tokens.shift() ?? '';
    }
    if (commandSession !== null && !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(commandSession)) {
      return false;
    }
    if (session !== undefined && session !== commandSession) {
      return false;
    }
    session = commandSession;
    const action = tokens.shift();
    if (action === 'snapshot') {
      if ((mode === 'credit' && index !== commands.length - 1) || tokens.length !== 0) {
        return false;
      }
      sawSnapshot = true;
    } else if (mode === 'credit' && index === commands.length - 1) {
      return false;
    } else if (action === 'open' || action === 'goto') {
      if (tokens.length !== 1 || !isHttpUrl(tokens[0]!)) {
        return false;
      }
    } else if (action === 'fill') {
      // The native CLI parses options across all argv, including quoted fill text.
      // A lone dash is positional; other leading-dash values can change behavior.
      if (
        tokens.length !== 2 ||
        !/^e\d+$/.test(tokens[0]!) ||
        (tokens[1]!.startsWith('-') && tokens[1] !== '-')
      ) {
        return false;
      }
    } else if (action === 'click') {
      if (tokens.length !== 1 || !/^e\d+$/.test(tokens[0]!)) {
        return false;
      }
    } else if (action === 'reload') {
      if (tokens.length !== 0) {
        return false;
      }
    } else if (mode === 'classify' && action === 'eval') {
      if (tokens.length !== 1) {
        return false;
      }
    } else {
      return false;
    }
  }
  return sawSnapshot;
}
