// Every filesystem operation runs inside the same OS sandbox as shell commands.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
const [operation, path] = process.argv.slice(2);

try {
  if (path === undefined) {
    throw new Error('A path is required');
  }

  if (operation === 'read') {
    process.stdout.write(await readFile(path));
  } else if (operation === 'access') {
    await access(path);
  } else if (operation === 'mkdir') {
    await mkdir(path, { recursive: true });
  } else if (operation === 'write') {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    await writeFile(path, Buffer.concat(chunks));
  } else {
    throw new Error('Unsupported file operation');
  }
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
