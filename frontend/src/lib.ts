export const formatBytes=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KB`:`${(n/1048576).toFixed(1)} MB`;
export const isSupported=(f:string)=>["EPUB","PDF","CBZ","TXT"].includes(f.toUpperCase());
export const cacheName="books-offline-v1";
export async function saveOffline(id:number, token:string){const r=await fetch(`/api/books/${id}/file`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok)throw new Error("No se pudo descargar");const c=await caches.open(cacheName);await c.put(`/offline/books/${id}`,r.clone());return r;}
export async function offlineBook(id:number){return (await caches.open(cacheName)).match(`/offline/books/${id}`)}
