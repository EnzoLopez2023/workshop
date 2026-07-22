// Generate per-page background images for Workshop using the same Azure OpenAI
// gpt-image model Hearth/ShopKeep use (GPT_IMAGE_ENDPOINT / GPT_IMAGE_API_KEY).
// Writes optimized JPGs to public/bg-<page>.jpg via sharp.
//
// Usage:
//   1. Put credentials in workshop/.env (gitignored — never committed):
//        GPT_IMAGE_ENDPOINT=https://<resource>.cognitiveservices.azure.com
//        GPT_IMAGE_API_KEY=<your-key>
//        # optional: GPT_IMAGE_DEPLOYMENT=gpt-image-2  GPT_IMAGE_API_VERSION=2025-04-01-preview
//   2. Run:  node scripts/generate-backgrounds.mjs            (all pages)
//            node scripts/generate-backgrounds.mjs dashboard  (one page)
//
// Images share a warm woodworking-studio aesthetic (cream / walnut / rust, soft
// light, generous negative space) so they read as subtle texture beneath each
// page's legibility veil.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import sharp from 'sharp';

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

const ENDPOINT    = (process.env.GPT_IMAGE_ENDPOINT || '').replace(/\/$/, '');
const API_KEY     = process.env.GPT_IMAGE_API_KEY;
const API_VERSION = process.env.GPT_IMAGE_API_VERSION || '2025-04-01-preview';
const DEPLOYMENT  = process.env.GPT_IMAGE_DEPLOYMENT || 'gpt-image-2';
const SIZE        = process.env.GPT_IMAGE_SIZE || '1536x1024';

const STYLE =
  'Cinematic wide establishing photograph, warm cream and walnut and rust color ' +
  'palette, soft golden woodworking-studio light, shallow depth of field with gentle ' +
  'bokeh, generous empty negative space, calm and refined and premium mood, ' +
  'muted low-contrast tones so it works as a subtle background. ' +
  'No people, no text, no words, no lettering, no numbers, no logos, no watermark. ' +
  'Horizontal composition.';

const PAGES = [
  {
    name: 'dashboard',
    prompt:
      'A warm, organized woodworking studio workbench at golden hour seen from a ' +
      'wide angle: hand tools resting, a few project boards, sawdust catching the ' +
      'light. Establishing overview, sense of calm craft. ' + STYLE,
  },
  {
    name: 'projects',
    prompt:
      'Handcrafted wooden furniture pieces in progress in a workshop — a dovetailed ' +
      'drawer, a glued-up walnut panel on clamps — receding into soft focus. ' +
      'A maker\u2019s project feeling, warm amber light. ' + STYLE,
  },
  {
    name: 'shaper',
    prompt:
      'A handheld precision CNC router resting on a plywood sheet marked with clean ' +
      'cut templates and registration tape, close and technical yet warm. Sense of ' +
      'digital-meets-handmade precision. ' + STYLE,
  },
  {
    name: 'conversions',
    prompt:
      'A flat-lay of woodworking measuring tools on a walnut surface — brass calipers, ' +
      'a folding rule, a combination square, a pencil — arranged neatly. Precision and ' +
      'measurement mood, soft copper light. ' + STYLE,
  },
  {
    name: 'shopping',
    prompt:
      'A neat stack of fresh lumber boards and a small pile of brass hardware and ' +
      'screws at a warm lumber yard, soft depth of field. Materials and supply feeling. ' + STYLE,
  },
  {
    name: 'notebook',
    prompt:
      'An open woodworking sketchbook with faint pencil joinery sketches beside a ' +
      'carpenter pencil and a mug on a walnut bench, warm morning light. Planning and ' +
      'note-taking mood, lots of open surface. ' + STYLE,
  },
  {
    name: 'settings',
    prompt:
      'A workshop maintenance flat-lay: small brass adjustment tools, an oil can, a ' +
      'sharpening stone and allen keys arranged neatly on a walnut surface. Sense of ' +
      'tuning and fine adjustment, warm light. ' + STYLE,
  },
];

async function generateOne({ name, prompt }) {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/images/generations?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': API_KEY },
    body: JSON.stringify({ prompt, size: SIZE, n: 1 }),
  });

  const raw = await res.text();
  if (!res.ok) throw new Error(`[${name}] image API error ${res.status}: ${raw.slice(0, 300)}`);

  const b64 = JSON.parse(raw)?.data?.[0]?.b64_json;
  if (!b64) throw new Error(`[${name}] no image returned by the model`);

  const outPath = join(PUBLIC_DIR, `bg-${name}.jpg`);
  await sharp(Buffer.from(b64, 'base64')).jpeg({ quality: 82, mozjpeg: true }).toFile(outPath);
  return outPath;
}

async function main() {
  if (!ENDPOINT || !API_KEY) {
    console.error('Missing credentials. Add GPT_IMAGE_ENDPOINT and GPT_IMAGE_API_KEY to workshop/.env.');
    process.exit(1);
  }

  const only = process.argv[2];
  const targets = only ? PAGES.filter(p => p.name === only) : PAGES;
  if (only && targets.length === 0) {
    console.error(`Unknown page "${only}". Options: ${PAGES.map(p => p.name).join(', ')}`);
    process.exit(1);
  }

  console.log(`Generating ${targets.length} background(s) with ${DEPLOYMENT} @ ${SIZE}…`);
  for (const page of targets) {
    process.stdout.write(`  • ${page.name} … `);
    try {
      const out = await generateOne(page);
      console.log(`saved ${out.replace(/.*\/public\//, 'public/')}`);
    } catch (err) {
      console.log('failed');
      console.error(`    ${err.message}`);
    }
  }
  console.log('Done.');
}

main();
