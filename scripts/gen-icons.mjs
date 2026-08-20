// Generate Workshop's browser icons from the canonical iOS app icon.
//
// app-store/AppIcon-1024.png must remain a byte-for-byte copy of the shipped
// iOS default icon. This script verifies that master before resizing it:
//
//   npm run icons
//
// Outputs:
//   public/favicon-32x32.png
//   public/apple-touch-icon.png  (full-bleed; iOS applies its own mask)
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const MASTER = join(ROOT, 'app-store', 'AppIcon-1024.png');
const EXPECTED_MASTER_SHA256 = 'cdf1ceedf57c10f71d543cae9aa0688683fb17d01dd503a5f9ebd275f0b8cc3e';

const source = await readFile(MASTER);
const digest = createHash('sha256').update(source).digest('hex');
if (digest !== EXPECTED_MASTER_SHA256) {
  throw new Error(`Unexpected app icon master SHA-256: ${digest}`);
}

const metadata = await sharp(source).metadata();
if (
  metadata.format !== 'png'
  || metadata.width !== 1024
  || metadata.height !== 1024
  || metadata.hasAlpha
) {
  throw new Error('App icon master must be an opaque 1024x1024 PNG');
}

for (const [filename, size] of [
  ['favicon-32x32.png', 32],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(source)
    .resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(join(PUBLIC, filename));
  console.log(`wrote public/${filename}`);
}
