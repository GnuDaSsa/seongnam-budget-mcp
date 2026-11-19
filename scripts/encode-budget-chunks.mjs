// Offline append indexing uses the exact tokenizer and quantized weights served by the Worker.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEncoder } from '../worker/semantic.js';

const root = path.resolve(process.argv[2]);
const encoder = await createEncoder({ASSETS: {async fetch(request) {
  const name = new URL(request.url).pathname;
  if (!/^\/semantic\/(?:vocab|common|centroids|page-docs|tokens-\d+)\.bin\.gz$/.test(name)) {
    throw new Error('Unexpected encoder asset ' + name);
  }
  return new Response(await readFile(path.join(root, name.slice(1))));
}}});
const parts = [];
for await (const part of process.stdin) parts.push(part);
const texts = JSON.parse(Buffer.concat(parts).toString('utf8'));
const tokens = texts.map(text => encoder.tokenize(text));
const used = [...new Set(tokens.flat())];
await encoder.ensure(used);
process.stdout.write(JSON.stringify({used, vectors: tokens.map(ids => Array.from(encoder.embed(ids)))}));
