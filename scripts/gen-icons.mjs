// Generate Workshop's PNG icons from public/favicon.svg.
//
// Source of truth is the SVG — this script rasterizes it via sharp so the
// 32x32 favicon fallback and the 180x180 apple-touch-icon look identical
// to the SVG in browsers. Run when the SVG changes:
//
//   node scripts/gen-icons.mjs
//
// Outputs:
//   public/favicon-32x32.png     (rounded bg — browsers render as-is)
//   public/apple-touch-icon.png  (square bg — iOS applies its own mask;
//                                 a rounded bg here would leave a gap of
//                                 transparency between our 18.75% radius
//                                 and iOS's ~22% squircle mask)
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT   = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');

const svgRounded = await readFile(join(PUBLIC, 'favicon.svg'), 'utf8');
// For the apple-touch render we strip the rounded corners from the bg
// rect — iOS layers its own squircle mask on top, and a rounded SVG bg
// underneath leaves visible transparent corners.
const svgSquare = svgRounded.replace(/<rect([^>]*?)rx="\d+(?:\.\d+)?"/, '<rect$1');

await sharp(Buffer.from(svgRounded))
  .resize(32, 32)
  .png({ compressionLevel: 9 })
  .toFile(join(PUBLIC, 'favicon-32x32.png'));
console.log('wrote public/favicon-32x32.png');

await sharp(Buffer.from(svgSquare))
  .resize(180, 180)
  .png({ compressionLevel: 9 })
  .toFile(join(PUBLIC, 'apple-touch-icon.png'));
console.log('wrote public/apple-touch-icon.png');
