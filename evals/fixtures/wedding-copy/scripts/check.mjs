import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(page, /<!doctype html>/i);
assert.match(page, /<html lang="en">/);
assert.match(page, /<title>[^<]+<\/title>/);
assert.match(page, /href="#schedule"/);
assert.match(page, /id="schedule"/);
console.log('Wedding page structure is valid.');
