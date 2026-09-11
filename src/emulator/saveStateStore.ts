import type { SaveStateSlot } from './types'

export type SaveStateRecord = SaveStateSlot & { id: string; data: Uint8Array }
export type HistoryReason = 'auto' | 'overwrite' | 'import' | 'delete' | 'before-load'
type HistoryRecord = SaveStateRecord & { historyId: string; archivedAt: number; reason: HistoryReason }
export type SaveHistory = Omit<HistoryRecord, 'data'>
type GameSaveBackup = {
  format: 'gba-center-save-backup'; version: 1; gameId: string; exportedAt: number
  states: Array<Omit<SaveStateRecord, 'id' | 'data'> & { data: string }>
}
const DATABASE_NAME = 'gba-center-saves'
const STORE_NAME = 'save-states'
const HISTORY = 'save-history'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(DATABASE_NAME, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(HISTORY)) db.createObjectStore(HISTORY, { keyPath: 'historyId' }).createIndex('gameId', 'gameId')
    }
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开存档数据库。'))
    request.onblocked = () => { blocked = true; reject(new Error('请关闭其他旧版游戏标签页，再重试存档。')) }
  })
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('存档操作失败。'))
    transaction.onabort = () => reject(transaction.error ?? new Error('存档操作已中止。'))
  })
}
function result<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
function archive(store: IDBObjectStore, record: SaveStateRecord, reason: HistoryReason) {
  store.put({ ...record, historyId: crypto.randomUUID(), archivedAt: Date.now(), reason } satisfies HistoryRecord)
}
// Trim within the same transaction; automatic snapshots cannot evict recovery points.
function trimHistory(store: IDBObjectStore, gameId: string) {
  const request = store.index('gameId').getAll(gameId)
  request.onsuccess = () => {
    const records = request.result as HistoryRecord[]
    for (const automatic of [true, false]) {
      const group = records.filter(r => (r.reason === 'auto') === automatic).sort((a, b) => b.archivedAt - a.archivedAt)
      for (const record of group.slice(automatic ? 120 : 100)) store.delete(record.historyId)
    }
  }
}
async function mutate(gameId: string, records: SaveStateRecord[], reason: HistoryReason, deleteSlot?: number) {
  const db = await openDatabase()
  try {
    const tx = db.transaction([STORE_NAME, HISTORY], 'readwrite')
    const done = completed(tx)
    const slots = tx.objectStore(STORE_NAME), history = tx.objectStore(HISTORY)
    for (const record of records) {
      const old = slots.get(record.id)
      old.onsuccess = () => {
        if (old.result) archive(history, old.result, reason)
        slots.put(record)
        trimHistory(history, gameId)
      }
    }
    if (deleteSlot !== undefined) {
      const id = gameId + ':' + deleteSlot
      const old = slots.get(id)
      old.onsuccess = () => {
        if (old.result) archive(history, old.result, 'delete')
        slots.delete(id)
        trimHistory(history, gameId)
      }
    }
    await done
  } finally { db.close() }
}
export async function writeSaveState(gameId: string, slot: number, data: Uint8Array, thumbnail: string, reason: HistoryReason = 'overwrite') {
  if (!data.length) throw new Error('核心返回空存档，已停止覆盖。')
  const record = { id: gameId + ':' + slot, gameId, slot, updatedAt: Date.now(), thumbnail, data: data.slice() }
  await mutate(gameId, [record], reason)
  return metadata(record)
}
function metadata({ gameId, slot, updatedAt, thumbnail }: SaveStateSlot): SaveStateSlot { return { gameId, slot, updatedAt, thumbnail } }
export async function readSaveState(gameId: string, slot: number) {
  const db = await openDatabase()
  try { return (await result<SaveStateRecord | undefined>(db.transaction(STORE_NAME).objectStore(STORE_NAME).get(gameId + ':' + slot))) ?? null }
  finally { db.close() }
}
export async function updateSaveThumbnail(gameId: string, slot: number, updatedAt: number, thumbnail: string) {
  const db = await openDatabase()
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite'), done = completed(tx)
    const store = tx.objectStore(STORE_NAME), request = store.get(gameId + ':' + slot)
    request.onsuccess = () => {
      const current = request.result as SaveStateRecord | undefined
      if (current?.updatedAt === updatedAt) store.put({ ...current, thumbnail })
    }
    await done
  } finally { db.close() }
}
export async function deleteSaveState(gameId: string, slot: number) { await mutate(gameId, [], 'delete', slot) }
async function allStates(gameId: string) {
  const db = await openDatabase()
  try { return (await result<SaveStateRecord[]>(db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll())).filter(r => r.gameId === gameId) }
  finally { db.close() }
}
export async function listSaveStates(gameId: string) { return (await allStates(gameId)).map(metadata).sort((a, b) => a.slot - b.slot) }
export async function listSaveHistory(gameId: string): Promise<SaveHistory[]> {
  const db = await openDatabase()
  try {
    const records = await result<HistoryRecord[]>(db.transaction(HISTORY).objectStore(HISTORY).index('gameId').getAll(gameId))
    return records.sort((a, b) => b.archivedAt - a.archivedAt).map(({ data: _data, ...record }) => record)
  } finally { db.close() }
}
export async function readSaveHistory(gameId: string, historyId: string) {
  const db = await openDatabase()
  try {
    const record = await result<HistoryRecord | undefined>(db.transaction(HISTORY).objectStore(HISTORY).get(historyId))
    if (!record || record.gameId !== gameId) throw new Error('找不到该历史存档。')
    return record
  } finally { db.close() }
}
export async function preserveBeforeLoad(gameId: string, data: Uint8Array, thumbnail: string) {
  const db = await openDatabase()
  try {
    const tx = db.transaction(HISTORY, 'readwrite'), done = completed(tx)
    archive(tx.objectStore(HISTORY), { id: gameId + ':-2', gameId, slot: -2, data, thumbnail, updatedAt: Date.now() }, 'before-load')
    trimHistory(tx.objectStore(HISTORY), gameId)
    await done
  } finally { db.close() }
}
function bytesToBase64(data: Uint8Array) {
  let binary = ''
  for (let offset = 0; offset < data.length; offset += 0x8000) binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
export async function exportGameSaveStates(gameId: string) {
  const backup: GameSaveBackup = {
    format: 'gba-center-save-backup', version: 1, gameId, exportedAt: Date.now(),
    states: (await allStates(gameId)).map(({ id: _id, data, ...record }) => ({ ...record, data: bytesToBase64(data) })),
  }
  return JSON.stringify(backup)
}
export async function importGameSaveStates(gameId: string, contents: string) {
  let backup: GameSaveBackup
  try { backup = JSON.parse(contents) } catch { throw new Error('备份文件不是有效的 JSON。') }
  if (!backup || backup.format !== 'gba-center-save-backup' || backup.version !== 1 || !Array.isArray(backup.states) || !backup.states.length || backup.states.length > 10) throw new Error('不是有效的存档备份。')
  if (backup.gameId !== gameId) throw new Error('该备份属于另一款游戏。')
  const seen = new Set<number>()
  const records = backup.states.map(state => {
    if (!state || !Number.isInteger(state.slot) || state.slot < -2 || state.slot > 7 || seen.has(state.slot) || typeof state.data !== 'string' || !Number.isFinite(state.updatedAt) || typeof state.thumbnail !== 'string') throw new Error('备份中包含无效或重复槽位。')
    seen.add(state.slot)
    const data = Uint8Array.from(atob(state.data), c => c.charCodeAt(0))
    if (!data.length) throw new Error('备份中包含空存档。')
    return { gameId, slot: state.slot, updatedAt: state.updatedAt, thumbnail: state.thumbnail, id: gameId + ':' + state.slot, data }
  })
  await mutate(gameId, records, 'import')
  return listSaveStates(gameId)
}
