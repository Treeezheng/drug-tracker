import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0
const legalName = /^(?:licen[cs]e(?:[._-].*)?|copying(?:[._-].*)?|copyright(?:[._-].*)?|ofl(?:[._-].*)?|notice(?:[._-].*)?|third[-_]?party.*(?:licen[cs]e|notice).*)$/i
// For example, Lucide's copyright.js is an icon, not a legal notice.
const codeOrAsset = /\.(?:[cm]?[jt]sx?|map|json|css|svg|woff2?|wasm)$/i

export function readNoticeBytes(filename) {
  // Open once, validate and read that descriptor. A replaced pathname cannot
  // switch the file between a path-based size check and its later read.
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0))
  try {
    if (!fs.fstatSync(fd).isFile()) throw new Error(`Not a regular notice file: ${filename}`)
    const limit = 4_000_000, chunks = []
    let total = 0
    for (;;) {
      // Enforce the limit on bytes actually read, including if the open file
      // grows concurrently; do not trust a previously observed file size.
      const buffer = Buffer.allocUnsafe(Math.min(65_536, limit + 1 - total))
      const length = fs.readSync(fd, buffer, 0, buffer.length, null)
      if (!length) return Buffer.concat(chunks, total)
      total += length
      if (total > limit) throw new Error(`Notice file too large: ${filename}`)
      chunks.push(buffer.subarray(0, length))
    }
  } finally {
    fs.closeSync(fd)
  }
}

function normalizeText(bytes, filename) {
  const text = bytes.toString('utf8').replace(/\r\n?/g, '\n')
  if (text.includes('\0') || text.includes('\uFFFD')) throw new Error(`Not a UTF-8 notice: ${filename}`)
  return text.trimEnd() + '\n'
}

const readText = filename => normalizeText(readNoticeBytes(filename), filename)

export function lockedPackages(lock) {
  const section = lock.match(/^packages:\n([\s\S]*?)(?=^snapshots:)/m)?.[1]
  if (!section) throw new Error('Expected pnpm lockfile packages and snapshots sections')
  return new Set([...section.matchAll(/^  (?:'([^']+)'|([^ '\n][^\n]*)):\s*$/gm)].map(match => match[1] ?? match[2]))
}

export function installedPackages(root, locked) {
  root = fs.realpathSync(root)
  const visited = new Set()
  const packages = new Map()
  const modules = fs.realpathSync(path.join(root, 'node_modules'))
  function locate(from, name) {
    for (let dir = from; ; dir = path.dirname(dir)) {
      try {
        const resolved = fs.realpathSync(path.join(dir, 'node_modules', name))
        const pkg = JSON.parse(readText(path.join(resolved, 'package.json')))
        return { dir: resolved, pkg }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
      if (dir === root || dir === path.dirname(dir)) return null
    }
  }
  function visit(dir, isRoot = false, suppliedManifest) {
    if (visited.has(dir)) return
    visited.add(dir)
    const pkg = suppliedManifest ?? JSON.parse(readText(path.join(dir, 'package.json')))
    if (!isRoot) {
      if (!dir.startsWith(modules + path.sep)) throw new Error(`Dependency outside project node_modules: ${pkg.name}`)
      const id = `${pkg.name}@${pkg.version}`
      if (!locked.has(id)) throw new Error(`Installed dependency missing from lockfile: ${id}`)
      if (!packages.has(id)) packages.set(id, { id, pkg, dir })
    }
    const names = new Set([
      ...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.optionalDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}), ...(isRoot ? Object.keys(pkg.devDependencies ?? {}) : []),
    ])
    for (const name of [...names].sort(compare)) {
      const dependency = locate(dir, name)
      if (dependency) visit(dependency.dir, false, dependency.pkg)
      else if (!(name in (pkg.optionalDependencies ?? {})) && !pkg.peerDependenciesMeta?.[name]?.optional) {
        throw new Error(`Required dependency not installed: ${pkg.name} -> ${name}`)
      }
    }
  }
  visit(root, true)
  return [...packages.values()].sort((a, b) => compare(a.id, b.id))
}

function legalFiles(dir) {
  const files = []
  function walk(relative) {
    for (const entry of fs.readdirSync(path.join(dir, relative), { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.isSymbolicLink()) continue
      const child = path.join(relative, entry.name)
      if (entry.isDirectory()) walk(child)
      else if (entry.isFile() && legalName.test(entry.name) && !codeOrAsset.test(entry.name)) files.push(child)
    }
  }
  walk('')
  return files.map(file => ({ source: file.split(path.sep).join('/'), text: readText(path.join(dir, file)) }))
}

export function readmeLicense(text) {
  const heading = /^(#{1,6})\s+licen[cs]e\s*#*\s*$/im.exec(text)
  if (!heading) return null
  const following = text.slice(heading.index + heading[0].length)
  const nextHeading = new RegExp(`^#{1,${heading[1].length}}\\s`, 'm').exec(following)
  const section = text.slice(heading.index, nextHeading ? heading.index + heading[0].length + nextHeading.index : undefined).trim()
  // A SPDX label alone is not a substitute for the supplied license terms.
  return /permission is hereby granted/i.test(section) && /the software is provided/i.test(section) ? section + '\n' : null
}

export function leadingComments(text) {
  let offset = 0
  while (offset < text.length) {
    const whitespace = /^\s*/.exec(text.slice(offset))[0].length
    const start = offset + whitespace
    if (text.startsWith('/*', start)) {
      const end = text.indexOf('*/', start + 2)
      if (end < 0) throw new Error('Unclosed source notice comment')
      offset = end + 2
    } else if (text.startsWith('//', start)) {
      const end = text.indexOf('\n', start)
      offset = end < 0 ? text.length : end + 1
    } else break
  }
  return text.slice(0, offset).trim()
}

const repository = pkg => (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url)?.replace(/^git\+/, '').replace(/\.git$/, '')

export function generateNotices(root, { platform = process.platform, arch = process.arch } = {}) {
  root = fs.realpathSync(root)
  const lockFile = path.join(root, 'pnpm-lock.yaml'), lockBytes = readNoticeBytes(lockFile)
  const lock = normalizeText(lockBytes, lockFile)
  const lockHash = createHash('sha256').update(lockBytes).digest('hex')
  const packages = installedPackages(root, lockedPackages(lock))
  let sections = 0
  let sourceHeaders = 0
  const blocks = []
  for (const entry of packages) {
    const { pkg, dir, id } = entry
    const notices = legalFiles(dir)
    if (!notices.length && ['pg-types', 'pgpass'].includes(pkg.name)) {
      const license = readmeLicense(readText(path.join(dir, 'README.md')))
      if (license) notices.push({ source: 'README.md — complete License section', text: license })
    }
    // These published native artifacts omit a license file. Their same-version
    // parent package, repository and declared license are checked before reuse.
    if (!notices.length) {
      const parentName = pkg.name.startsWith('@esbuild/') ? 'esbuild' : pkg.name.startsWith('@rolldown/binding-') ? 'rolldown' : null
      const parent = packages.find(item => item.pkg.name === parentName && item.pkg.version === pkg.version)
      if (parent && pkg.license === parent.pkg.license && repository(pkg) && repository(pkg) === repository(parent.pkg)) {
        notices.push(...legalFiles(parent.dir).map(notice => ({ ...notice, source: `${parent.id}/${notice.source} — same-version parent package notice` })))
      }
    }
    if (!notices.length) throw new Error(`No reviewed complete license source for ${id}`)
    if (pkg.name === 'hash-wasm') {
      for (const file of fs.readdirSync(path.join(dir, 'src')).filter(file => /\.[ch]$/.test(file)).sort(compare)) {
        const header = leadingComments(readText(path.join(dir, 'src', file)))
        // The shared declarations header has no leading attribution; its package
        // MIT license is already included. Every shipped C implementation does.
        if (!header && file === 'hash-wasm.h') continue
        if (!header) throw new Error(`Missing hash-wasm source attribution: ${file}`)
        notices.push({ source: `src/${file} — leading source notice`, text: header + '\n' })
        sourceHeaders++
      }
    }
    sections += notices.length
    blocks.push(`PACKAGE ${id}\nDeclared package license: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n${notices.map(notice => `\nSOURCE ${notice.source}\n\n${notice.text}`).join('\n')}`)
  }
  const scope = `${packages.length} installed packages; ${sections} notice sections; ${sourceHeaders} hash-wasm source headers`
  const txt = `THIRD-PARTY NOTICES\n\nThird-party packages retain their original licenses. The project's 0BSD license does not replace them.\nGenerated offline from the reachable installed runtime and development dependency graph, verified against pnpm-lock.yaml.\nScope: ${scope}.\nInstallation platform: ${platform}/${arch}. Uninstalled optional platform packages and stale package-store entries are excluded.\nLockfile SHA-256: ${lockHash}\n\nThese are the legal texts and source notices supplied in the installed packages. Native esbuild/rolldown artifacts without a notice use the verified same-version parent package's supplied notices. pg-types/pgpass notices come from their README License sections. hash-wasm's embedded implementation notices are preserved from leading source comments. This inventory does not assert an independent audit of upstream or embedded components.\nRegenerate: node scripts/third-party-notices.mjs\nCheck this installation: node scripts/third-party-notices.mjs --check\n\n${blocks.join('\n' + '='.repeat(78) + '\n\n')}`
  const md = `# Third-party notices\n\nOriginal application code is under 0BSD. Third-party dependencies retain their own licenses; the 0BSD grant does not replace them.\n\nThe interface uses Inter and IBM Plex Mono under the SIL Open Font License 1.1. The installed OPAQUE package, hash-wasm, React, Lucide, Temporal, and other dependencies retain their supplied licenses and copyright notices. Password dictionary dataset notices and hash-wasm's embedded implementation notices are included.\n\n[The distributed notices](public/THIRD_PARTY_NOTICES.txt) contain ${scope}. They cover the installed runtime and development dependency graph on ${platform}/${arch}, with every package version checked against the lockfile. Uninstalled optional platform packages and unreachable old package-store entries are excluded; development packages are not necessarily shipped in the browser.\n\nRegenerate offline after a frozen-lockfile installation with \`node scripts/third-party-notices.mjs\`; verify the same installation with \`node scripts/third-party-notices.mjs --check\`. The script reads supplied legal files, complete README license sections for pg-types/pgpass, and hash-wasm source headers. Native esbuild/rolldown packages without their own notice use the same-version parent package's notices after checking the repository and declared license. Missing or unrecognized license sources cause generation to fail. No package scripts or network requests are run. This inventory is not an independent license audit of embedded upstream components.\n\nLockfile SHA-256: \`${lockHash}\`.\n\nExternal medical documents are linked as references; their copyrights and trademarks remain with their owners. This project does not grant rights to those external materials.\n`
  // Preserve upstream words and indentation, but omit trailing line whitespace
  // from the distributed inventory so generated files pass whitespace checks.
  const cleanLines = text => text.split('\n').map(line => line.trimEnd()).join('\n')
  return { txt: cleanLines(txt), md: cleanLines(md), count: packages.length, sections, sourceHeaders, ids: packages.map(entry => entry.id) }
}

function noticeInventory(text) {
  const first = text.indexOf('\n\nPACKAGE ')
  if (first < 0) throw new Error('Malformed notice inventory')
  const header = text.slice(0, first)
  const platform = /^Installation platform: ([a-z0-9_-]+)\/([a-z0-9_-]+)\./m.exec(header)
  const scope = /^Scope: (\d+ installed packages; \d+ notice sections; \d+ hash-wasm source headers)\.$/m.exec(header)
  if (!platform || !scope) throw new Error('Missing notice scope or installation platform')
  const entries = new Map()
  let sections = 0, sourceHeaders = 0
  for (const block of text.slice(first + 2).split('\n' + '='.repeat(78) + '\n\n')) {
    const id = /^PACKAGE ([^\n]+)\nDeclared package license: [^\n]+\n/.exec(block)?.[1]
    if (!id || entries.has(id)) throw new Error('Malformed or duplicate notice package')
    entries.set(id, block)
    sections += [...block.matchAll(/^SOURCE /gm)].length
    if (id.startsWith('hash-wasm@')) sourceHeaders += [...block.matchAll(/^SOURCE src\/[^\n]+ — leading source notice$/gm)].length
  }
  const actual = `${entries.size} installed packages; ${sections} notice sections; ${sourceHeaders} hash-wasm source headers`
  if (actual !== scope[1]) throw new Error('Notice inventory counts do not match its contents')
  return { entries, scope: actual, platform: platform[1], arch: platform[2], header: header.replace(actual, '<scope>').replace(`${platform[1]}/${platform[2]}`, '<platform>') }
}

function lockPlatformRules(lock) {
  const section = lock.match(/^packages:\n([\s\S]*?)(?=^snapshots:)/m)?.[1]
  if (!section) throw new Error('Expected pnpm lockfile packages and snapshots sections')
  const headings = [...section.matchAll(/^  (?:'([^']+)'|([^ '\n][^\n]*)):\s*$/gm)]
  return new Map(headings.map((heading, index) => [heading[1] ?? heading[2], section.slice(heading.index + heading[0].length, headings[index + 1]?.index)]))
}

function incompatibleWith(body, { platform, arch }) {
  // Only explicit OS/CPU differences justify missing package notices. In
  // particular, an optional dependency without these constraints is not skipped.
  const matches = (field, target) => {
    const line = new RegExp(`^    ${field}: (.+)$`, 'm').exec(body)?.[1]
    if (!line) return true
    if (!/^\[[^\]\n]*\]$/.test(line)) throw new Error(`Unsupported lockfile ${field} constraint`)
    const values = line.slice(1, -1).split(',').map(value => value.trim().replace(/^(['"])(.*)\1$/, '$2'))
    if (values.some(value => !/^!?[a-z0-9_*-]+$/.test(value))) throw new Error(`Unsupported lockfile ${field} constraint`)
    const positive = values.filter(value => !value.startsWith('!'))
    return !values.includes(`!${target}`) && (!positive.length || positive.includes('*') || positive.includes(target))
  }
  return !matches('os', platform) || !matches('cpu', arch)
}

/** Read-only CI check. Shared packages must match in full; only explicitly
 * incompatible platform packages may differ. Noninstalled platform legal text
 * is not re-audited; same-platform --check remains the complete byte comparison. */
export function checkNotices(root, { portable = false, platform = process.platform, arch = process.arch } = {}) {
  const result = generateNotices(root, { platform, arch })
  const txt = readNoticeBytes(path.join(root, 'public/THIRD_PARTY_NOTICES.txt')).toString('utf8')
  const md = readNoticeBytes(path.join(root, 'THIRD_PARTY_NOTICES.md')).toString('utf8')
  if (txt === result.txt && md === result.md) return result
  if (!portable) throw new Error('Stale notices: regenerate with node scripts/third-party-notices.mjs')
  const saved = noticeInventory(txt), current = noticeInventory(result.txt)
  if (saved.platform === current.platform && saved.arch === current.arch) throw new Error('Stale notices for this installation platform')
  const rules = lockPlatformRules(readText(path.join(root, 'pnpm-lock.yaml')))
  if (saved.header !== current.header) throw new Error('Stale notice header or lockfile hash')
  const normalizeSummary = (text, inventory) => text.replace(inventory.scope, '<scope>').replace(`on ${inventory.platform}/${inventory.arch},`, 'on <platform>,')
  if (normalizeSummary(md, saved) !== normalizeSummary(result.md, current)) throw new Error('Stale notices: THIRD_PARTY_NOTICES.md')
  for (const [id, block] of saved.entries) {
    if (!rules.has(id)) throw new Error(`Notice package is missing from lockfile: ${id}`)
    if (current.entries.has(id)) {
      if (block !== current.entries.get(id)) throw new Error(`Stale notice text: ${id}`)
    } else if (!incompatibleWith(rules.get(id), current)) throw new Error(`Unexpected notice package absent from this installation: ${id}`)
  }
  for (const id of current.entries.keys()) {
    if (!saved.entries.has(id) && !incompatibleWith(rules.get(id), saved)) throw new Error(`Missing notice package: ${id}`)
  }
  return result
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length > 1 || args.some(arg => !['--check', '--check-portable'].includes(arg))) throw new Error('Usage: node scripts/third-party-notices.mjs [--check | --check-portable]')
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const checking = args.length > 0
  const result = checking ? checkNotices(root, { portable: args[0] === '--check-portable' }) : generateNotices(root)
  if (!checking) {
    fs.writeFileSync(path.join(root, 'public/THIRD_PARTY_NOTICES.txt'), result.txt)
    fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), result.md)
  }
  console.log(`${checking ? 'Verified' : 'Generated'} ${result.count} packages, ${result.sections} notice sections, ${result.sourceHeaders} embedded source headers${args[0] === '--check-portable' ? ' (cross-platform check; uninstalled platform-only notices are not re-audited)' : ''}.`)
}
