import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

export function parseDirectPlaywright(command) {
  if (/[\r\n]/.test(command)) return null;
  // No shell substitutions, operators, assignments, aliases, or caller-selected executable.
  const tokens = command.trim().match(/(?:"[^"\\]*"|'[^']*'|[^\s"']+)/g);
  if (!tokens || tokens.join(' ') !== command.trim().replace(/\s+/g, ' ')) return null;
  const args = tokens.map((token) => (/^['"]/.test(token) ? token.slice(1, -1) : token));
  if (args.shift() !== 'playwright-cli' || args.some((arg) => /[\n\r$`;&|<>\\]/.test(arg)))
    return null;
  if (
    args.some((arg) =>
      /^--(?:config|browser|cdp|endpoint|extension|profile|persistent)(?:=|$)/.test(arg),
    )
  )
    return null;
  return args;
}
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const within = (root, path) => {
  const value = relative(root, path);
  return value === '' || (!value.startsWith('../') && value !== '..' && !isAbsolute(value));
};

export default async function installBoundary(pi) {
  const config = JSON.parse(await readFile(process.env.EVAL_ISOLATION_CONFIG, 'utf8'));
  const native = await import(config.piModule);
  const targetHash = async () => {
    try {
      return hash(await fileOperation('read', config.targetFile));
    } catch {
      return null;
    }
  };
  async function checkedPath(path, writing = false) {
    const absolute = resolve(config.workspace, path);
    const roots = writing
      ? config.writableDirectories
      : [config.workspace, ...config.resourceDirectories];
    if (
      !roots.some((root) => within(root, absolute)) &&
      !(!writing && config.resourceFiles.includes(absolute))
    )
      throw new Error(
        'Tool access is limited to the isolated trial and its instruction resources.',
      );
    // Resolve the nearest existing ancestor, so creation through an escaping symlink is also rejected.
    let existing = absolute;
    while (true) {
      try {
        const actual = await realpath(existing);
        if (
          !roots.some((root) => within(root, actual)) &&
          !(!writing && config.resourceFiles.includes(actual))
        )
          throw new Error('Symlink escapes the isolated trial.');
        break;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const parent = dirname(existing);
        if (parent === existing) throw error;
        existing = parent;
      }
    }
    return absolute;
  }
  function execute(executable, args, { signal, timeout = 60, onData = () => {}, input } = {}) {
    return new Promise((resolveResult, reject) => {
      const child = spawn(
        '/usr/bin/sandbox-exec',
        ['-f', config.profilePath, executable, ...args],
        {
          cwd: config.workspace,
          env: config.toolEnv,
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      if (child.pid)
        appendFileSync(
          config.processRegistryPath,
          JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }) + '\n',
        );
      const chunks = [];
      const kill = () => {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {}
      };
      const timer = setTimeout(kill, Math.min(timeout * 1000, config.commandTimeoutMs));
      signal?.addEventListener('abort', kill, { once: true });
      child.on('error', reject);
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk) => {
          chunks.push(chunk);
          onData(chunk);
        });
      child.on('close', (exitCode) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', kill);
        resolveResult({ exitCode, output: Buffer.concat(chunks) });
      });
      child.stdin.end(input);
    });
  }
  async function fileOperation(operation, path, input) {
    await checkedPath(path, ['write', 'mkdir'].includes(operation));
    const result = await execute(config.nodeExecutable, [config.workerPath, operation, path], {
      input,
    });
    if (result.exitCode !== 0)
      throw new Error(result.output.toString('utf8') || 'Isolated file operation failed');
    return result.output;
  }
  const read = native.createReadTool(config.workspace, {
    operations: {
      readFile: (path) => fileOperation('read', path),
      access: async (path) => {
        await fileOperation('access', path);
      },
    },
  });
  const edit = native.createEditTool(config.workspace, {
    operations: {
      readFile: (path) => fileOperation('read', path),
      access: async (path) => {
        await fileOperation('access', path);
      },
      writeFile: async (path, content) => {
        await fileOperation('write', path, content);
      },
    },
  });
  const write = native.createWriteTool(config.workspace, {
    operations: {
      mkdir: async (path) => {
        await fileOperation('mkdir', path);
      },
      writeFile: async (path, content) => {
        await fileOperation('write', path, content);
      },
    },
  });
  for (const tool of [read, edit, write])
    pi.registerTool({
      ...tool,
      async execute(id, params, signal, onUpdate, ctx) {
        const before = await targetHash();
        let result;
        try {
          result = await tool.execute(id, params, signal, onUpdate, ctx);
        } catch (error) {
          result = { content: [{ type: 'text', text: error.message }], isError: true };
        }
        let sha256;
        if (tool.name === 'read') {
          try {
            sha256 = hash(await fileOperation('read', resolve(config.workspace, params.path)));
          } catch {}
        }
        return {
          ...result,
          details: {
            ...result.details,
            evaluation: {
              kind: `file-${tool.name}`,
              path: params.path,
              sha256,
              targetBeforeHash: before,
              targetAfterHash: await targetHash(),
            },
          },
        };
      },
    });
  pi.registerTool({
    ...native.createBashTool(config.workspace),
    async execute(id, params, signal, onUpdate, ctx) {
      const before = await targetHash();
      const direct = parseDirectPlaywright(params.command);
      let execution;
      const tool = native.createBashTool(config.workspace, {
        exposeSessionEnvironment: false,
        operations: {
          exec: async (command, _cwd, options) => {
            execution = await execute(
              direct ? config.nodeExecutable : '/bin/bash',
              direct
                ? [
                    config.playwrightExecutable,
                    ...direct,
                    ...(direct.includes('open') ? [`--config=${config.browserConfigPath}`] : []),
                  ]
                : ['--noprofile', '--norc', '-c', command],
              options,
            );
            return { exitCode: execution.exitCode };
          },
        },
      });
      let result;
      try {
        result = await tool.execute(id, params, signal, onUpdate, ctx);
      } catch (error) {
        result = { content: [{ type: 'text', text: error.message }], isError: true };
      }
      const evaluation = {
        kind: direct ? 'playwright-cli' : 'bash',
        args: direct ?? undefined,
        exitCode: execution?.exitCode,
        targetBeforeHash: before,
        targetAfterHash: await targetHash(),
      };
      if (direct && execution) {
        const daemon = execution.output
          .toString('utf8')
          .match(/### Browser[^\n]*opened with pid (\d+)/);
        if (daemon)
          appendFileSync(
            config.processRegistryPath,
            JSON.stringify({
              pid: Number(daemon[1]),
              startedAt: new Date().toISOString(),
              kind: 'playwright-daemon',
            }) + '\n',
          );
      }
      if (direct?.includes('snapshot') && execution?.exitCode === 0) {
        const output = execution.output.toString('utf8');
        const inline = output.match(/```ya?ml\r?\n([\s\S]*?)\r?\n```/);
        if (inline)
          evaluation.snapshot = {
            path: `tool-output:${id}`,
            content: inline[1],
            sha256: hash(inline[1]),
          };
        const paths = [...output.matchAll(/\.playwright-cli\/[^\s)\]"'<>]+\.ya?ml/g)].map(
          (match) => match[0],
        );
        for (const path of paths) {
          try {
            const actual = await checkedPath(resolve(config.workspace, path));
            const content = await fileOperation('read', actual);
            evaluation.snapshot = {
              path,
              content: content.toString('utf8'),
              sha256: hash(content),
            };
            break;
          } catch {}
        }
      }
      if (evaluation.snapshot)
        await writeFile(
          resolve(config.snapshotReceiptDirectory, hash(id) + '.json'),
          JSON.stringify(evaluation.snapshot),
        );
      return { ...result, details: { ...result.details, evaluation } };
    },
  });
  pi.registerCommand('eval-sandbox-ready-v1', {
    description: 'Evaluation tool boundary installed',
    handler: async () => {},
  });
  pi.on('session_start', async () => {
    pi.setActiveTools(['read', 'bash', 'edit', 'write']);
  });
}
