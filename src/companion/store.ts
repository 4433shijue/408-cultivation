import { freshData, validateData } from "./rules";
import type { CompanionData } from "./types";
let connection: Promise<IDBDatabase> | undefined;
function open() {
  return (connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("lingtian-companion", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("profiles", { keyPath: "profileId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(Error("陪伴记录无法打开，请检查浏览器存储权限"));
  }));
}
export async function readData(id: string) {
  const db = await open();
  return new Promise<CompanionData>((resolve, reject) => {
    const r = db.transaction("profiles").objectStore("profiles").get(id);
    r.onsuccess = () => {
      try {
        resolve(r.result ? validateData(r.result) : freshData(id));
      } catch (e) {
        reject(e);
      }
    };
    r.onerror = () => reject(r.error);
  });
}
export async function putData(data: CompanionData) {
  validateData(data);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction("profiles", "readwrite");
    t.objectStore("profiles").put(data);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(Error("陪伴记录保存失败，原进度未覆盖"));
    t.onabort = () => reject(Error("陪伴记录写入被中止"));
  });
}
export async function mutateData<T>(
  id: string,
  fn: (d: CompanionData) => T | Promise<T>,
): Promise<{ data: CompanionData; result: T }> {
  return navigator.locks.request("lingtian-companion-" + id, async () => {
    const data = await readData(id);
    const result = await fn(data);
    await putData(data);
    return { data, result };
  });
}
