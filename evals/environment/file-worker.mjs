// Every filesystem operation runs inside the same OS sandbox as shell commands.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
const [operation, path] = process.argv.slice(2);
try {
  if (operation === 'read') process.stdout.write(await readFile(path));
  else if (operation === 'access') await access(path);
  else if (operation === 'mkdir') await mkdir(path, { recursive: true });
  else if (operation === 'write') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    await writeFile(path, Buffer.concat(chunks));
  } else throw new Error('Unsupported file operation');
} catch (error) {
  process.stderr.write(error.message);
  process.exitCode = 1;
}
