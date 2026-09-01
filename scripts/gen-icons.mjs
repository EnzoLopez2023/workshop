// Generate Workshop's browser icons from the canonical raster master.
//
// app-store/AppIcon-1024.png is the immutable source for every Workshop web
// icon. This script verifies that master before resizing it:
//
//   npm run icons
//   npm run icons:check
//
// Outputs:
//   public/favicon-32x32.png
//   public/apple-touch-icon.png  (full-bleed; iOS applies its own mask)
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MASTER = join(ROOT, 'app-store', 'AppIcon-1024.png');
const INDEX_HTML = join(ROOT, 'index.html');
const EXPECTED_MASTER_SHA256 = '66fe71c864f0353b473f9c14d89be9aa1c683df045d48bb4b8f479086b834172';
const CHECK = process.argv.slice(2).includes('--check');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--check');

if (unknownArgs.length > 0) {
  throw new Error(`Unknown argument${unknownArgs.length === 1 ? '' : 's'}: ${unknownArgs.join(', ')}`);
}

const outputs = [
  {
    filename: 'favicon-32x32.png',
    size: 32,
    htmlReference: '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
  },
  {
    filename: 'apple-touch-icon.png',
    size: 180,
    htmlReference: '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
  },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function assertOpaqueSquarePng(bytes, size, label) {
  const metadata = await sharp(bytes).metadata();
  if (
    metadata.format !== 'png'
    || metadata.width !== size
    || metadata.height !== size
    || metadata.hasAlpha
  ) {
    throw new Error(`${label} must be an opaque ${size}x${size} PNG`);
  }
}

const source = await readFile(MASTER);
const digest = sha256(source);
if (digest !== EXPECTED_MASTER_SHA256) {
  throw new Error(
    `Unexpected app icon master SHA-256: ${digest} (expected ${EXPECTED_MASTER_SHA256})`,
  );
}
await assertOpaqueSquarePng(source, 1024, 'App icon master');

const html = await readFile(INDEX_HTML, 'utf8');
const activeHtml = html.replace(/<!--[\s\S]*?-->/g, '');
for (const { htmlReference } of outputs) {
  if (!activeHtml.includes(htmlReference)) {
    throw new Error(`Missing icon reference in index.html: ${htmlReference}`);
  }
}

const wiredIconLinks = activeHtml.match(/<link\b[^>]*\brel="(?:icon|apple-touch-icon)"[^>]*>/g) ?? [];
if (
  wiredIconLinks.length !== outputs.length
  || wiredIconLinks.some((link) => !outputs.some(({ htmlReference }) => htmlReference === link))
) {
  throw new Error('index.html icon references differ from the generated icon manifest');
}

for (const { filename, size } of outputs) {
  const expected = await sharp(source)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  await assertOpaqueSquarePng(expected, size, `Generated public/${filename}`);

  const destination = join(PUBLIC, filename);
  if (CHECK) {
    const actual = await readFile(destination).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error(`Missing generated icon: public/${filename}`);
      }
      throw error;
    });
    await assertOpaqueSquarePng(actual, size, `Existing public/${filename}`);
    if (!actual.equals(expected)) {
      throw new Error(
        `Generated icon bytes differ: public/${filename} `
        + `(actual ${sha256(actual)}, expected ${sha256(expected)}). Run npm run icons.`,
      );
    }
    console.log(`verified public/${filename}`);
  } else {
    await writeFile(destination, expected);
    console.log(`wrote public/${filename}`);
  }
}

if (CHECK) {
  console.log(`verified app-store/AppIcon-1024.png (${EXPECTED_MASTER_SHA256})`);
  console.log('verified index.html icon references');
}
