import type { SavedProject } from "../types";

const databaseName = "iiif-ocr-annotation-editor";
const storeName = "projects";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = database.transaction(storeName, mode);
    const request = run(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => database.close();
    tx.onerror = () => reject(tx.error);
  });
}

export function projectStorageKey(manifestId: string, tsvFingerprint: string) {
  return `${manifestId}::${tsvFingerprint}`;
}

export function loadSavedProject(key: string) {
  return transaction<SavedProject | undefined>("readonly", (store) => store.get(key));
}

export function saveProject(project: SavedProject) {
  return transaction<IDBValidKey>("readwrite", (store) => store.put(project, project.projectKey));
}
