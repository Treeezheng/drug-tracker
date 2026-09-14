/** Cooperative cross-tab exclusion for guest saves, consent changes and cleanup. */
export async function withGuestStorageLock<T>(action:()=>T|Promise<T>):Promise<T>{
  if(typeof navigator==='undefined'||!navigator.locks){
    return Promise.reject(new Error('This browser cannot coordinate device storage safely. Continue in memory, or use a current browser.'));
  }
  return await navigator.locks.request('drug-tracker:guest-storage',action);
}
