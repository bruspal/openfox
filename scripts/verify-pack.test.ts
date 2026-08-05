import { describe, it, expect } from 'vitest'
import { collectReferencedPaths, findMissingFiles } from './verify-pack.js'

describe('collectReferencedPaths', () => {
  it('extracts the file referenced by a node lifecycle script', () => {
    expect(collectReferencedPaths({ scripts: { postinstall: 'node scripts/postinstall.mjs' } })).toEqual([
      'scripts/postinstall.mjs',
    ])
  })

  it('collects every install-time lifecycle hook but skips other scripts', () => {
    const pkg = {
      scripts: {
        preinstall: 'node scripts/a.mjs',
        install: 'node scripts/b.mjs',
        postinstall: 'node scripts/postinstall.mjs',
        prepare: 'node scripts/prepare.mjs',
        dev: 'node scripts/dev.mjs',
        build: 'node scripts/build.mjs',
      },
    }
    expect(collectReferencedPaths(pkg)).toEqual([
      'scripts/a.mjs',
      'scripts/b.mjs',
      'scripts/postinstall.mjs',
      'scripts/prepare.mjs',
    ])
  })

  it('ignores npx invocations and non-node commands', () => {
    expect(
      collectReferencedPaths({ scripts: { postinstall: 'npx playwright install && node scripts/postinstall.mjs' } }),
    ).toEqual(['scripts/postinstall.mjs'])
  })

  it('handles node flags before the file path', () => {
    expect(
      collectReferencedPaths({ scripts: { postinstall: 'node --max-old-space-size=2048 scripts/postinstall.mjs' } }),
    ).toEqual(['scripts/postinstall.mjs'])
  })

  it('collects bin paths from the string form', () => {
    expect(collectReferencedPaths({ bin: './dist/cli/index.js' })).toEqual(['dist/cli/index.js'])
  })

  it('collects bin paths from the record form', () => {
    expect(
      collectReferencedPaths({ bin: { openfox: './dist/cli/index.js', 'openfox-dev': './dist/cli/dev.js' } }),
    ).toEqual(['dist/cli/dev.js', 'dist/cli/index.js'])
  })

  it('returns an empty list for a manifest with no install-time file references', () => {
    expect(collectReferencedPaths({ scripts: { start: 'node dist/cli/index.js' } })).toEqual([])
  })
})

describe('findMissingFiles', () => {
  it('reports references absent from the packed file list', () => {
    expect(findMissingFiles(['scripts/postinstall.mjs', 'dist/cli/index.js'], ['dist/cli/index.js'])).toEqual([
      'scripts/postinstall.mjs',
    ])
  })

  it('passes when every reference is packed', () => {
    expect(
      findMissingFiles(
        ['scripts/postinstall.mjs', 'dist/cli/index.js'],
        ['dist/cli/index.js', 'scripts/postinstall.mjs', 'CHANGELOG.md'],
      ),
    ).toEqual([])
  })

  it('tolerates a leading ./ on references', () => {
    expect(findMissingFiles(['./dist/cli/index.js'], ['dist/cli/index.js'])).toEqual([])
  })

  it('tolerates a package/ prefix on packed paths', () => {
    expect(findMissingFiles(['scripts/postinstall.mjs'], ['package/scripts/postinstall.mjs'])).toEqual([])
  })

  it('deduplicates and sorts the missing list', () => {
    expect(findMissingFiles(['b.mjs', 'a.mjs', 'b.mjs'], [])).toEqual(['a.mjs', 'b.mjs'])
  })
})
