#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const

export interface PackageManifest {
  bin?: string | Record<string, string>
  scripts?: Record<string, string>
}

function normalizePath(path: string): string {
  return path.replace(/^(\.\/|package\/)+/, '')
}

function extractNodeFileRefs(script: string): string[] {
  const refs: string[] = []
  for (const match of script.matchAll(/\bnode\s+([^\s"'&|;]+(?:\s+[^\s"'&|;]+)*)/g)) {
    const tokens = (match[1] ?? '').split(/\s+/)
    const file = tokens.find((token) => !token.startsWith('--'))
    if (file) refs.push(normalizePath(file))
  }
  return refs
}

export function collectReferencedPaths(pkg: PackageManifest): string[] {
  const refs = new Set<string>()
  for (const hook of LIFECYCLE_SCRIPTS) {
    const script = pkg.scripts?.[hook]
    if (!script) continue
    for (const ref of extractNodeFileRefs(script)) refs.add(ref)
  }
  if (typeof pkg.bin === 'string') {
    refs.add(normalizePath(pkg.bin))
  } else if (pkg.bin) {
    for (const binPath of Object.values(pkg.bin)) refs.add(normalizePath(binPath))
  }
  return [...refs].sort()
}

export function findMissingFiles(references: string[], packedPaths: Iterable<string>): string[] {
  const packed = new Set([...packedPaths].map(normalizePath))
  return [...new Set(references.map(normalizePath))].filter((ref) => !packed.has(ref)).sort()
}

export function parsePackJson(stdout: string): string[] {
  const parsed: unknown = JSON.parse(stdout)
  const entries = Array.isArray(parsed) ? parsed : [parsed]
  return entries.flatMap(
    (entry) => (entry as { files?: Array<{ path: string }> }).files?.map((file) => file.path) ?? [],
  )
}

function main(): void {
  const cwd = process.argv[2] ?? '.'
  const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as PackageManifest
  const references = collectReferencedPaths(pkg)
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd, encoding: 'utf8' })
  const missing = findMissingFiles(references, parsePackJson(stdout))

  console.log(`[verify-pack] References: ${references.length > 0 ? references.join(', ') : '(none)'}`)
  if (missing.length === 0) {
    console.log('[verify-pack] OK — every install-time file reference ships in the tarball')
    return
  }
  console.error('[verify-pack] FAILED — referenced files missing from the packed tarball:')
  for (const file of missing) console.error(`  - ${file}`)
  console.error('[verify-pack] Hint: add them to the "files" array in package.json')
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
