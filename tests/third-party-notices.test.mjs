import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkNotices, generateNotices, installedPackages, leadingComments, lockedPackages, readmeLicense, readNoticeBytes } from '../scripts/third-party-notices.mjs'

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

test('notice reading binds validation and bounded reads to the same open descriptor', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dose-notice-read-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const filename = path.join(root, 'LICENSE'), moved = path.join(root, 'original')
  const original = Buffer.from('Original license with trailing spaces  \r\n')
  fs.writeFileSync(filename, original)
  const fstat = fs.fstatSync
  let replaced = false
  const mock = t.mock.method(fs, 'fstatSync', function(fd, ...args) {
    const result = fstat.call(fs, fd, ...args)
    if (!replaced) {
      replaced = true
      fs.renameSync(filename, moved)
      fs.writeFileSync(filename, 'Replacement contents')
    }
    return result
  })
  assert.deepEqual(readNoticeBytes(filename), original, 'Replacing the pathname after opening cannot substitute its contents.')
  mock.mock.restore()
  assert.throws(() => readNoticeBytes(path.join(root, 'missing')), { code: 'ENOENT' })
  assert.throws(() => readNoticeBytes(root), /Not a regular notice file/)
  if (fs.constants.O_NOFOLLOW) {
    const link = path.join(root, 'symlink')
    fs.symlinkSync(filename, link)
    assert.throws(() => readNoticeBytes(link), { code: 'ELOOP' })
  }
  fs.writeFileSync(filename, 'A')
  const growth = t.mock.method(fs, 'fstatSync', function(fd, ...args) {
    const result = fstat.call(fs, fd, ...args)
    fs.appendFileSync(filename, Buffer.alloc(4_000_000, 65))
    return result
  })
  assert.throws(() => readNoticeBytes(filename), /Notice file too large/)
  growth.mock.restore()
})

function crossPlatformFixture(t, darwinRule = '[darwin]') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dose-portable-notices-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const lock = `lockfileVersion: '9.0'\npackages:\n  runtime@1.0.0:\n    resolution: {}\n  darwin-native@1.0.0:\n    os: ${darwinRule}\n  linux-native@1.0.0:\n    os: [linux]\n    cpu: [x64]\n  shared-optional@1.0.0:\n    resolution: {}\nsnapshots:\n`
  const install = (root, name) => {
    const dir = path.join(root, 'node_modules', name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license: 'MIT' }))
    fs.writeFileSync(path.join(dir, 'LICENSE'), `Copyright ${name}\nPermission is hereby granted.\nTHE SOFTWARE IS PROVIDED AS IS.\n`)
  }
  const roots = {}
  for (const platform of ['darwin', 'linux']) {
    const root = roots[platform] = path.join(directory, platform)
    fs.mkdirSync(path.join(root, 'public'), { recursive: true })
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { runtime: '1.0.0' }, optionalDependencies: { 'darwin-native': '1.0.0', 'linux-native': '1.0.0', 'shared-optional': '1.0.0' } }))
    fs.writeFileSync(path.join(root, 'pnpm-lock.yaml'), lock)
    install(root, 'runtime')
    install(root, `${platform}-native`)
  }
  const publish = () => {
    const generated = generateNotices(roots.darwin, { platform: 'darwin', arch: 'arm64' })
    for (const root of Object.values(roots)) {
      fs.writeFileSync(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), generated.txt)
      fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), generated.md)
    }
  }
  publish()
  const check = () => checkNotices(roots.linux, { portable: true, platform: 'linux', arch: 'x64' })
  return { ...roots, install, publish, check }
}

test('portable notice check accepts only genuine OS/CPU differences and never rewrites the distribution', t => {
  const fixture = crossPlatformFixture(t)
  const before = ['public/THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.md'].map(file => fs.readFileSync(path.join(fixture.linux, file)))
  assert.equal(fixture.check().count, 2)
  assert.throws(() => checkNotices(fixture.linux, { platform: 'linux', arch: 'x64' }), /Stale notices/)
  assert.equal(checkNotices(fixture.darwin, { platform: 'darwin', arch: 'arm64' }).count, 2)
  const after = ['public/THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.md'].map(file => fs.readFileSync(path.join(fixture.linux, file)))
  assert.deepEqual(after, before)
})

test('portable notice check rejects stale lockfiles and changed shared legal text', t => {
  const fixture = crossPlatformFixture(t)
  const license = path.join(fixture.linux, 'node_modules/runtime/LICENSE')
  const original = fs.readFileSync(license)
  fs.appendFileSync(license, 'An additional required attribution.\n')
  assert.throws(fixture.check, /Stale notice text: runtime@1.0.0/)
  fs.writeFileSync(license, original)
  fs.appendFileSync(path.join(fixture.linux, 'pnpm-lock.yaml'), '# Changed lockfile\n')
  assert.throws(fixture.check, /Stale notice header or lockfile hash/)
})

test('portable notice check cannot excuse missing unrestricted optional packages as platform differences', t => {
  const fixture = crossPlatformFixture(t)
  fixture.install(fixture.linux, 'shared-optional')
  assert.throws(fixture.check, /Missing notice package: shared-optional@1.0.0/)
  fs.rmSync(path.join(fixture.linux, 'node_modules/shared-optional'), { recursive: true })
  fixture.install(fixture.darwin, 'shared-optional')
  fixture.publish()
  assert.throws(fixture.check, /Unexpected notice package absent from this installation: shared-optional@1.0.0/)
})

test('portable notice check rejects omitted packages compatible with both platforms', t => {
  const fixture = crossPlatformFixture(t, '[darwin, linux]')
  assert.throws(fixture.check, /Unexpected notice package absent from this installation: darwin-native@1.0.0/)
})

test('portable notice check accepts explicit CPU exclusions without relying on OS package names', t => {
  const fixture = crossPlatformFixture(t)
  for (const root of [fixture.darwin, fixture.linux]) {
    const file = path.join(root, 'pnpm-lock.yaml')
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('os: [darwin]', 'cpu: [arm64]').replace('    os: [linux]\n', ''))
  }
  fixture.publish()
  assert.equal(fixture.check().count, 2)
})

test('portable notice check validates both published files and inventory counts', t => {
  const fixture = crossPlatformFixture(t)
  const markdown = path.join(fixture.linux, 'THIRD_PARTY_NOTICES.md')
  fs.appendFileSync(markdown, 'An unintended disclosure change.\n')
  assert.throws(fixture.check, /Stale notices: THIRD_PARTY_NOTICES.md/)
  fixture.publish()
  const text = path.join(fixture.linux, 'public/THIRD_PARTY_NOTICES.txt')
  fs.writeFileSync(text, fs.readFileSync(text, 'utf8').replace('2 installed packages', '3 installed packages'))
  assert.throws(fixture.check, /Notice inventory counts do not match/)
})
