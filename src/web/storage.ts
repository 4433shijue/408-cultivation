const database = new Promise<IDBDatabase>((resolve, reject) => {
  const open = indexedDB.open("lingtian-web-services", 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("jobs", { keyPath: "id" });
    open.result.createObjectStore("library");
  };
  open.onsuccess = () => resolve(open.result);
  open.onerror = () => reject(Error("浏览器题库与任务记录无法打开"));
});
export async function get(store: string, key: string): Promise<any> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const r = db.transaction(store).objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function put(store: string, value: unknown, key?: string) {
  const db = await database;
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    if (key === undefined) t.objectStore(store).put(value);
    else t.objectStore(store).put(value, key);
    t.oncomplete = () => resolve();
    t.onabort = t.onerror = () => reject(Error("浏览器记录保存失败"));
  });
}
export async function remove(store: string, key: string) {
  const db = await database;
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    t.objectStore(store).delete(key);
    t.oncomplete = () => resolve();
    t.onabort = t.onerror = () => reject(Error("记录删除失败"));
  });
}
export async function digest(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(bytes)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}
