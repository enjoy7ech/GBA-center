import type { SaveStateSlot } from './types'

type SaveStateRecord = SaveStateSlot & {
  id: string
  data: Uint8Array
}

type GameSaveBackup = {
  format: 'gba-center-save-backup'
  version: 1
  gameId: string
  exportedAt: number
  states: Array<Omit<SaveStateRecord, 'id' | 'data'> & { data: string }>
}

const DATABASE_NAME = 'gba-center-saves'
const STORE_NAME = 'save-states'

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开浏览器存档数据库。'))
  })
}

function slotId(gameId: string, slot: number) {
  return `${gameId}:${slot}`
}

export async function writeSaveState(gameId: string, slot: number, data: Uint8Array, thumbnail: string) {
  const database = await openDatabase()
  const record: SaveStateRecord = {
    id: slotId(gameId, slot), gameId, slot, updatedAt: Date.now(), thumbnail, data: data.slice(),
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('写入存档失败。'))
      transaction.onabort = () => reject(transaction.error ?? new Error('写入存档已中止。'))
    })
    return { gameId, slot, updatedAt: record.updatedAt, thumbnail } satisfies SaveStateSlot
  } finally {
    database.close()
  }
}

export async function readSaveState(gameId: string, slot: number) {
  const database = await openDatabase()
  try {
    return await new Promise<SaveStateRecord | null>((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(slotId(gameId, slot))
      request.onsuccess = () => resolve((request.result as SaveStateRecord | undefined) ?? null)
      request.onerror = () => reject(request.error ?? new Error('读取存档失败。'))
    })
  } finally {
    database.close()
  }
}

export async function deleteSaveState(gameId: string, slot: number) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(slotId(gameId, slot))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('删除存档失败。'))
    })
  } finally {
    database.close()
  }
}

export async function listSaveStates(gameId: string) {
  const database = await openDatabase()
  try {
    const records = await new Promise<SaveStateRecord[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as SaveStateRecord[])
      request.onerror = () => reject(request.error ?? new Error('读取存档失败。'))
    })
    return records
      .filter(record => record.gameId === gameId && record.slot >= -2 && record.slot < 8)
      .map(({ gameId: id, slot, updatedAt, thumbnail }) => ({ gameId: id, slot, updatedAt, thumbnail }))
      .sort((left, right) => left.slot - right.slot)
  } finally {
    database.close()
  }
}

function bytesToBase64(data: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string) {
  const binary = atob(value)
  const data = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) data[index] = binary.charCodeAt(index)
  return data
}

export async function exportGameSaveStates(gameId: string) {
  const database = await openDatabase()
  try {
    const records = await new Promise<SaveStateRecord[]>((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()
      request.onsuccess = () => resolve(request.result as SaveStateRecord[])
      request.onerror = () => reject(request.error ?? new Error('导出存档失败。'))
    })
    const backup: GameSaveBackup = {
      format: 'gba-center-save-backup',
      version: 1,
      gameId,
      exportedAt: Date.now(),
      states: records.filter(record => record.gameId === gameId).map(({ id: _id, data, ...record }) => ({ ...record, data: bytesToBase64(data) })),
    }
    return JSON.stringify(backup)
  } finally {
    database.close()
  }
}

export async function importGameSaveStates(gameId: string, contents: string) {
  let backup: GameSaveBackup
  try { backup = JSON.parse(contents) as GameSaveBackup } catch { throw new Error('备份文件不是有效的 JSON。') }
  if (backup.format !== 'gba-center-save-backup' || backup.version !== 1 || !Array.isArray(backup.states)) throw new Error('不是有效的“董哥的小神游”存档备份。')
  if (backup.gameId !== gameId) throw new Error('该备份属于另一款游戏，不能导入当前游戏。')

  const records = backup.states.map(state => {
    if (!Number.isInteger(state.slot) || state.slot < -2 || state.slot > 7 || typeof state.data !== 'string') throw new Error('备份中包含无效的存档槽位。')
    return { ...state, gameId, id: slotId(gameId, state.slot), data: base64ToBytes(state.data) } satisfies SaveStateRecord
  })
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      records.forEach(record => store.put(record))
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error ?? new Error('导入存档失败。'))
      transaction.onabort = () => reject(transaction.error ?? new Error('导入存档已中止。'))
    })
    return listSaveStates(gameId)
  } finally {
    database.close()
  }
}
