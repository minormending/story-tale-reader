/**
 * A minimal promise wrapper over IndexedDB.
 *
 * Small enough to own outright, and keeping it dependency-free means the storage
 * layer behaves the same on the ancient WebViews that ship on cheap tablets
 * (SPEC.md §9.3) as it does on a desktop browser.
 */

const DB_NAME = 'story-tale-reader'
const DB_VERSION = 1

export const STORE_BOOKS = 'books'
export const STORE_PROGRESS = 'progress'
export const STORE_OVERRIDES = 'overrides'
export const STORE_BLOBS = 'blobs'

let connection: Promise<IDBDatabase> | undefined

export function openDatabase(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of [STORE_BOOKS, STORE_PROGRESS, STORE_OVERRIDES, STORE_BLOBS]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
  return connection
}

function run<T>(store: IDBObjectStore, request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(`IndexedDB ${store.name} failed`))
  })
}

export async function put<T>(storeName: string, value: T): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  await run(store, store.put(value))
}

export async function get<T>(storeName: string, key: string): Promise<T | undefined> {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readonly')
  const store = tx.objectStore(storeName)
  return run<T | undefined>(store, store.get(key) as IDBRequest<T | undefined>)
}

export async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readonly')
  const store = tx.objectStore(storeName)
  return run<T[]>(store, store.getAll() as IDBRequest<T[]>)
}

export async function remove(storeName: string, key: string): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction(storeName, 'readwrite')
  const store = tx.objectStore(storeName)
  await run(store, store.delete(key))
}
