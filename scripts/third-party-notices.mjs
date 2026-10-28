/** Collect the installed production dependency licenses for each desktop package. */
import { createRequire } from 'node:module'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'resources', 'third-party')
const licenses = path.join(root, 'licenses')
const json = file => JSON.parse(readFileSync(file, 'utf8'))
const supplemental = {
  'artplayer@5.4.0': ['artplayer-MIT.txt'],
  'artplayer-plugin-danmuku@5.3.0': ['artplayer-MIT.txt'],
  'boolbase@1.0.0': ['boolbase-ISC.txt'],
  'lazy-val@1.0.5': ['lazy-val-MIT.txt'],
  'onnxruntime-common@1.23.2': ['onnxruntime-MIT.txt'],
  'onnxruntime-node@1.23.2': [
    'onnxruntime-MIT.txt',
    'onnxruntime-ThirdPartyNotices.txt',
  ],
  '@vue/devtools-api@6.6.4': ['vue-devtools-MIT.txt'],
}

/** Package exports can resolve inside dist; find the actual named package root. */
function packageRoot(name, from) {
  const require = createRequire(path.join(from, 'package.json'))
  let dir
  try {
    dir = path.dirname(require.resolve(`${name}/package.json`))
  } catch {
    dir = path.dirname(require.resolve(name))
  }
  while (true) {
    const file = path.join(dir, 'package.json')
    if (existsSync(file) && json(file).name === name) return realpathSync(dir)
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error(`Cannot locate package ${name}`)
    dir = parent
  }
}

/** Return every installed production package, including optional native packages. */
function productionPackages() {
  const packages = new Map()
  function visit(name, from, optional = false) {
    let dir
    try {
      dir = packageRoot(name, from)
    } catch (error) {
      if (optional && error.code === 'MODULE_NOT_FOUND') return
      throw error
    }
    const pkg = json(path.join(dir, 'package.json'))
    const key = `${pkg.name}@${pkg.version}`
    if (packages.has(key)) return
    packages.set(key, { key, dir, pkg })
    const optionalNames = new Set(Object.keys(pkg.optionalDependencies ?? {}))
    for (const dep of Object.keys(pkg.dependencies ?? {}))
      visit(dep, dir, optionalNames.has(dep))
    for (const dep of optionalNames) visit(dep, dir, true)
  }
  const pkg = json(path.join(root, 'package.json'))
  for (const dep of Object.keys(pkg.dependencies)) visit(dep, root)
  return [...packages.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Collect license directories as well as individual license files. */
function licenseFiles(dir, relative = '') {
  return readdirSync(path.join(dir, relative), { withFileTypes: true })
    .filter(
      entry =>
        relative ||
        /^(licen[cs]e|copying|notice|copyright|third.?party)/i.test(entry.name)
    )
    .flatMap(entry => {
      const file = path.join(relative, entry.name)
      return entry.isDirectory() ? licenseFiles(dir, file) : [file]
    })
}

export function generateNotices() {
  mkdirSync(output, { recursive: true })
  const sections = []
  const manifest = []
  for (const { key, dir, pkg } of productionPackages()) {
    const files = licenseFiles(dir)
    const extras = supplemental[key] ?? []
    if (!files.length && !extras.length)
      throw new Error(
        `Missing license text: ${key}; add a verified copy under licenses/`
      )
    const texts = [
      ...files.map(
        file => `--- ${file} ---\n${readFileSync(path.join(dir, file), 'utf8')}`
      ),
      ...extras.map(
        file =>
          `--- ${file} ---\n${readFileSync(path.join(licenses, file), 'utf8')}`
      ),
    ]
    sections.push(
      `## ${key}\n\nLicense: ${typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)}\n\n${texts.join('\n\n')}`
    )
    manifest.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      files,
      supplemental: extras,
    })
  }
  writeFileSync(path.join(output, 'npm-NOTICES.txt'), sections.join('\n\n'))
  writeFileSync(
    path.join(output, 'npm-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  copyFileSync(
    path.join(root, 'THIRD_PARTY_NOTICES.md'),
    path.join(output, 'THIRD_PARTY_NOTICES.md')
  )
  copyFileSync(
    path.join(root, 'docs', 'release-licenses.md'),
    path.join(output, 'release-licenses.md')
  )
  const electron = packageRoot('electron', root)
  for (const file of ['LICENSE', 'LICENSES.chromium.html'])
    copyFileSync(
      path.join(electron, 'dist', file),
      path.join(output, `electron-${file}`)
    )
  console.log(
    `Third-party notices: ${manifest.length} production packages + Electron/Chromium`
  )
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  generateNotices()
