import { browser } from 'wxt/browser';
import type { StorageArea } from './ports';

type Area = typeof browser.storage.local;

export function chromeArea(area: Area): StorageArea {
  return {
    async get(key) {
      const out: Record<string, unknown> = await area.get(key);
      return out[key];
    },
    async set(key, value) {
      await area.set({ [key]: value });
    },
    async remove(key) {
      await area.remove(key);
    },
    async clear() {
      await area.clear();
    },
  };
}

/** Deletes every IndexedDB database this extension created (one per paired account). */
export async function wipeIndexedDb(): Promise<void> {
  const dbs = await indexedDB.databases();
  await Promise.all(
    dbs.flatMap((db) =>
      db.name === undefined
        ? []
        : [
            new Promise<void>((resolve, reject) => {
              const req = indexedDB.deleteDatabase(db.name as string);
              req.onsuccess = () => resolve();
              req.onerror = () => reject(req.error ?? new Error('IndexedDB delete failed'));
              req.onblocked = () => resolve();
            }),
          ],
    ),
  );
}
