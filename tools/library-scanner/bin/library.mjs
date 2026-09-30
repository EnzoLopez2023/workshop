#!/usr/bin/env node
// workshop-library — organizer / scanner CLI for Workshop's Library hub.
//
//   scan                      index every root, print totals
//   plan [--intake]           write _Library/migration-plan.json (nothing moves)
//   apply <plan> [ids...|--all] [--dry-run]
//   intake [--dry-run]        auto-file settled downloads into _Inbox/ (or ShapePilot/)
//   batches                   list logged batches
//   undo <batch> [--dry-run]  reverse one batch
//   status                    config + counts

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadConfig, CONFIG_PATH } from '../src/config.js'
import { scanAll, ScanCache } from '../src/scan.js'
import { buildPlan, applyPlan } from '../src/plan.js'
import { listBatches, undoBatch } from '../src/fsops.js'

const [command = 'help', ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((a) => a.startsWith('--')))
const args = rest.filter((a) => !a.startsWith('--'))
const config = loadConfig()
const dryRun = flags.has('--dry-run')

function scan(roots) {
  const started = Date.now()
  const cache = new ScanCache(config.cacheDir)
  const result = scanAll(config, {
    cache,
    roots,
    onProgress: (n) => {
      if (process.stderr.isTTY && n % 10 === 0) process.stderr.write(`\r  scanned ${n} files…`)
    },
  })
  if (process.stderr.isTTY) process.stderr.write('\r')
  result.ms = Date.now() - started
  return result
}

function planPath() {
  return join(config.libraryRoot, '_Library', 'migration-plan.json')
}

function printPlan(plan) {
  const s = plan.summary
  console.log(`Plan: ${s.models} models to file, ${s.moves} moves, ${s.extracts} ZIP entries to extract, ${s.trash} duplicates to Trash (${mb(s.trashBytes)})`)
  console.log(`Already organized: ${s.alreadyOrganized} model folders`)
  console.log('By destination:', Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '))
  if (plan.skipped.length) console.log(`Skipped ${plan.skipped.length} paths (see plan.skipped)`)
}

function notify(message) {
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title "Workshop Library"`])
  } catch {
    // Notifications are best-effort (launchd sessions without a GUI cannot show them).
  }
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

switch (command) {
  case 'scan': {
    const { records, errors, ms } = scan()
    const by = (key) => records.reduce((acc, r) => ((acc[r[key]] = (acc[r[key]] ?? 0) + 1), acc), {})
    console.log(`Scanned ${records.length} model files in ${(ms / 1000).toFixed(1)}s`)
    console.log('By root type:', by('rootType'))
    console.log('By kind:', by('kind'))
    const dupes = Object.values(records.reduce((acc, r) => ((acc[r.sha256] ??= []).push(r), acc), {})).filter((g) => g.length > 1)
    console.log(`Exact duplicate groups: ${dupes.length} (${dupes.reduce((n, g) => n + g.length - 1, 0)} extra copies)`)
    if (errors.length) {
      console.log(`Parse problems: ${errors.length}`)
      for (const e of errors.slice(0, 10)) console.log(`  ${e.relPath}: ${e.error}`)
    }
    break
  }
  case 'plan': {
    const intakeOnly = flags.has('--intake')
    const { records } = scan()
    const plan = buildPlan(config, records, { intakeOnly })
    const out = args[0] ?? planPath()
    mkdirSync(join(out, '..'), { recursive: true })
    writeFileSync(out, JSON.stringify(plan, null, 2))
    printPlan(plan)
    console.log(`\nWrote ${out}\nNothing has been moved. Review it, then: workshop-library apply "${out}" --all`)
    break
  }
  case 'apply': {
    const file = args[0] ?? planPath()
    if (!existsSync(file)) throw new Error(`No plan at ${file}; run "plan" first`)
    const plan = JSON.parse(readFileSync(file, 'utf8'))
    const ids = flags.has('--all') ? null : args.slice(1)
    if (ids && !ids.length) throw new Error('Pass model ids to apply, or --all')
    const result = applyPlan(config, plan, { ids, dryRun })
    const failed = result.results.filter((r) => !r.ok)
    console.log(`${dryRun ? '[dry run] ' : ''}Batch ${result.batch}: ${result.results.length - failed.length} models filed, ${result.ops} operations logged`)
    for (const f of failed) console.log(`  ✗ ${f.title}: ${f.error}`)
    if (!dryRun) console.log(`Undo with: workshop-library undo ${result.batch}`)
    break
  }
  case 'intake': {
    const roots = [{ path: config.libraryRoot, type: 'library' }, ...config.intakeRoots.map((path) => ({ path, type: 'intake' }))]
    const { records } = scan(roots)
    const plan = buildPlan(config, records, { intakeOnly: true })
    if (!plan.models.length) {
      console.log('Nothing new in Downloads.')
      break
    }
    const result = applyPlan(config, plan, { dryRun, kind: 'intake' })
    const filed = result.results.filter((r) => r.ok)
    console.log(`${dryRun ? '[dry run] ' : ''}Intake batch ${result.batch}: ${filed.map((r) => r.title).join(', ')}`)
    for (const f of result.results.filter((r) => !r.ok)) console.log(`  ✗ ${f.title}: ${f.error}`)
    if (!dryRun && filed.length) notify(`${filed.length} new model${filed.length === 1 ? '' : 's'} in Inbox`)
    break
  }
  case 'batches': {
    for (const b of listBatches(config.libraryRoot)) console.log(`${b.batch}  ${b.kind ?? ''}  ${b.ops} ops${b.undone ? '  (undone)' : ''}`)
    break
  }
  case 'undo': {
    if (!args[0]) throw new Error('Usage: undo <batch>')
    const n = undoBatch(config.libraryRoot, args[0], { dryRun })
    console.log(`${dryRun ? '[dry run] ' : ''}Reversed ${n} operations from ${args[0]}`)
    break
  }
  case 'status': {
    console.log(`Config: ${CONFIG_PATH}${existsSync(CONFIG_PATH) ? '' : ' (defaults)'}`)
    console.log(JSON.stringify({ ...config, deviceToken: config.deviceToken ? '••••' : null, categoryKeywords: undefined, legacyFolders: undefined }, null, 2))
    break
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
}
