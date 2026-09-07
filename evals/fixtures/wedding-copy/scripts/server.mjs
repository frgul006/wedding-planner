import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const page = fileURLToPath(new URL('../index.html', import.meta.url));
const server = createServer(async (request, response) => {
  if (!['/', '/index.html'].includes(new URL(request.url, 'http://localhost').pathname)) {
    response.writeHead(404); response.end('Not found'); return;
  }
  try { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(await readFile(page)); }
  catch { response.writeHead(500); response.end('Unable to read page'); }
});
server.listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log(`Local wedding website: http://127.0.0.1:${server.address().port}`));
