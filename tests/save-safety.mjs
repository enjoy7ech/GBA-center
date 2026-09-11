// Requires Playwright (or PLAYWRIGHT_MODULE pointing to an installed package).
// CHROMIUM_EXECUTABLE optionally selects an installed Chrome/Edge executable.
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import assert from 'node:assert/strict'

const require = createRequire(new URL('../package.json', import.meta.url))
const ts = require('typescript')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const modules = {}
for (const [url, path] of [['/store.js', 'saveStateStore'], ['/adapter.js', 'mgbaCoreAdapter']]) {
  const source = await readFile(new URL('../src/emulator/' + path + '.ts', import.meta.url), 'utf8')
  modules[url] = ts.transpileModule(source.replace("'./saveStateStore'", "'./store.js'"), { compilerOptions: { target: 99, module: 99 } }).outputText
}
const server = createServer((req, res) => {
  res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' : 'text/html')
  res.end(modules[req.url] || '<html>Isolated save safety test</html>')
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const origin = 'http://127.0.0.1:' + server.address().port
let browser
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE || undefined })
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(origin)
  await page.evaluate(async () => {
    const check = (value, message) => { if (!value) throw Error(message) }
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('gba-center-saves', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('save-states', { keyPath: 'id' })
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction('save-states', 'readwrite')
        tx.objectStore('save-states').put({ id: 'test:0', gameId: 'test', slot: 0, updatedAt: 1, thumbnail: '', data: new Uint8Array([1]) })
        tx.oncomplete = () => { db.close(); resolve() }
      }
    })
    const store = await import('/store.js')
    const { MgbaCoreAdapter: Adapter } = await import('/adapter.js')
    check((await store.readSaveState('test', 0)).data[0] === 1, 'v1 migration must preserve data')
    await store.writeSaveState('test', 0, new Uint8Array([9]), '')
    const backup = { format: 'gba-center-save-backup', version: 1, gameId: 'test', states: [{ slot: 0, updatedAt: 2, data: 'Ag==', thumbnail: '' }] }
    await store.importGameSaveStates('test', JSON.stringify(backup))
    const imported = (await store.listSaveHistory('test')).find(h => h.reason === 'import')
    check((await store.readSaveHistory('test', imported.historyId)).data[0] === 9, 'import preserves overwritten data')
    await store.deleteSaveState('test', 0)
    check(await store.readSaveState('test', 0) === null, 'delete slot')
    check((await store.listSaveHistory('test')).some(h => h.reason === 'delete'), 'delete recovery point')

    await store.writeSaveState('rollback', 0, new Uint8Array([9]), '')
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'save-history') throw new DOMException('Injected quota failure', 'QuotaExceededError')
      return original.apply(this, args)
    }
    let failed = false
    try { await store.writeSaveState('rollback', 0, new Uint8Array([1]), '') } catch { failed = true }
    finally { IDBObjectStore.prototype.put = original }
    check(failed && (await store.readSaveState('rollback', 0)).data[0] === 9, 'archive failure rolls back overwrite')

    for (let n = 0; n < 124; n++) await store.writeSaveState('retention', -2, new Uint8Array([n]), '', 'auto')
    await store.writeSaveState('retention', 0, new Uint8Array([1]), '')
    await store.writeSaveState('retention', 0, new Uint8Array([2]), '')
    const history = await store.listSaveHistory('retention')
    check(history.filter(h => h.reason === 'auto').length === 120 && history.length === 121, 'separate retention limits')

    const adapter = window.adapter = new Adapter({})
    adapter.gameId = 'core'
    adapter.module = { HEAPU8: new Uint8Array([7]), FS: { unlink() {}, writeFile(path, data) { adapter.module.HEAPU8 = data.slice() } } }
    adapter.saveStateInfo = () => '1|0|1'
    adapter.loadStateFile = () => 1
    adapter.canvas = { remove() {} }
    adapter.renderThumbnail = () => { throw Error('Injected screenshot failure') }
    await adapter.saveState(-1)
    check((await store.readSaveState('core', -1)).data[0] === 7, 'screenshot failure must not block save')
    adapter.module.HEAPU8 = new Uint8Array([9])
    const exported = JSON.parse(await adapter.exportStates())
    check(atob(exported.states.find(s => s.slot === -2).data).charCodeAt(0) === 9, 'export captures live progress')
    await adapter.importStates(JSON.stringify({ ...backup, gameId: 'core' }))
    check(!adapter.canAutoSave() && await adapter.saveState(-2, true) === null, 'import prevents automatic overwrite')
    await adapter.loadState(0)
    check(adapter.canAutoSave() && adapter.module.HEAPU8[0] === 2, 'explicit load resumes auto saving')
    const recovery = (await store.listSaveHistory('core')).find(h => h.reason === 'before-load')
    check((await store.readSaveHistory('core', recovery.historyId)).data[0] === 9, 'capture progress before loading')
    await adapter.loadHistory(recovery.historyId)
    check(adapter.module.HEAPU8[0] === 9, 'history restores original progress')

    const triple = { ...backup, gameId: 'phone', states: [-2, -1, 0].map(slot => ({ ...backup.states[0], slot })) }
    check((await store.importGameSaveStates('phone', JSON.stringify(triple))).length === 3, 'all three imported slots remain available')
    triple.states[2].data = '%%%'
    let rejected = false
    try { await store.importGameSaveStates('phone', JSON.stringify(triple)) } catch { rejected = true }
    check(rejected && (await store.listSaveStates('phone')).length === 3, 'invalid third record rejects entire import')
    await adapter.acquireSession('session-test')
  })
  const second = await context.newPage()
  await second.goto(origin)
  assert.equal(await second.evaluate(async () => {
    const { MgbaCoreAdapter } = await import('/adapter.js')
    window.adapter = new MgbaCoreAdapter({})
    try { await adapter.acquireSession('session-test'); return false } catch { return true }
  }), true, 'second tab must not acquire active game')
  await page.evaluate(() => adapter.destroy())
  await second.evaluate(async () => { await adapter.acquireSession('session-test'); adapter.destroy() })
  console.log('PASS: migration, atomic recovery, retention, import, export, screenshots, history restore, multi-tab lock')
} finally {
  await browser?.close()
  await new Promise(resolve => server.close(resolve))
}
