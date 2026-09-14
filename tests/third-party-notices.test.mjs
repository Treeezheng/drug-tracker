import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { installedPackages, leadingComments, lockedPackages, readmeLicense } from '../scripts/third-party-notices.mjs'

test('notice inventory follows reachable installed dependencies, including peers, without stale packages', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dose-notices-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const manifest = (name, data) => {
    const dir = name ? path.join(root, 'node_modules', name) : root
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(data))
  }
  manifest('', { name: 'fixture', dependencies: { runtime: '1' }, devDependencies: { tool: '2' } })
  manifest('runtime', { name: 'runtime', version: '1.0.0', peerDependencies: { peer: '1' }, optionalDependencies: { 'other-platform': '1' } })
  manifest('tool', { name: 'tool', version: '2.0.0' })
  manifest('peer', { name: 'peer', version: '1.0.0' })
  manifest('removed-pdf', { name: 'removed-pdf', version: '9.0.0' })
  const locked = lockedPackages("lockfileVersion: '9.0'\npackages:\n  runtime@1.0.0:\n    resolution: {}\n  'peer@1.0.0':\n    resolution: {}\n  tool@2.0.0:\n    resolution: {}\nsnapshots:\n")
  assert.deepEqual(installedPackages(root, locked).map(entry => entry.id), ['peer@1.0.0', 'runtime@1.0.0', 'tool@2.0.0'])
  locked.delete('peer@1.0.0')
  assert.throws(() => installedPackages(root, locked), /missing from lockfile: peer@1.0.0/)
  locked.add('peer@1.0.0')
  fs.rmSync(path.join(root, 'node_modules', 'peer'), { recursive: true })
  assert.throws(() => installedPackages(root, locked), /Required dependency not installed/)
})

test('README extraction keeps full license text and excludes unrelated subsequent sections', () => {
  const text = '# Package\nDescription\n## License\nCopyright Example\nPermission is hereby granted, free of charge.\nTHE SOFTWARE IS PROVIDED AS IS.\n## Usage\ncode\n'
  assert.equal(readmeLicense(text), '## License\nCopyright Example\nPermission is hereby granted, free of charge.\nTHE SOFTWARE IS PROVIDED AS IS.\n')
  assert.equal(readmeLicense('# Package\n## License\nMIT\n'), null)
})

test('embedded implementation extraction retains consecutive attribution blocks without code', () => {
  const text = '/* Copyright A\n * Terms A\n */\n\n// Public domain implementation\n/* Modified by B */\n#include <stdint.h>\nint example;\n'
  assert.equal(leadingComments(text), '/* Copyright A\n * Terms A\n */\n\n// Public domain implementation\n/* Modified by B */')
  assert.equal(leadingComments('#include <stdint.h>\n'), '')
  assert.throws(() => leadingComments('/* incomplete'), /Unclosed/)
})
