import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class IdbService {
  static DB_NAME = 'screen2csv';

  private db: any;

  private resetEverytime = false;

  async init() {
    return new Promise((resolve, reject) => {
      const request = window.indexedDB.open(IdbService.DB_NAME, 1);
      request.onupgradeneeded = function (e) {
        const db = (e.target as any).result;
        db.createObjectStore(IdbService.DB_NAME, { keyPath: 'key' });
      }
      request.onsuccess = (e: any) => {
        this.db = e.target.result;
        if (this.resetEverytime) {
          console.log('RESETTING IDB');
          this.clear();
        }
        resolve(undefined);
      }

      request.onerror = (e: any) => reject();
    });
  }

  clear() {
    // reset idb
    this.db.transaction([IdbService.DB_NAME], "readwrite")
      .objectStore(IdbService.DB_NAME)
      .clear();
  }

  async get(key: string, defaultValue: any = null): Promise<any | null> {
    return new Promise((resolve, reject) => {
      let request = this.db.transaction([IdbService.DB_NAME])
      .objectStore(IdbService.DB_NAME)
      .get(key);
    
      request.onerror = function (event: any) {
        console.log('Failed to load ' + key);
        console.log(event);
        resolve(null);
      }
      request.onsuccess = function () {
        let data = request.result == null ? defaultValue : request.result.value;
        resolve(data);
      }
    });
  }

  async put(key: string, value: any): Promise<void> {
    return new Promise((resolve, reject) => {
      let transaction = this.db.transaction([IdbService.DB_NAME], "readwrite");
      let request = transaction.objectStore(IdbService.DB_NAME).put({ key: key, value: value });
      request.onerror = (event: any) => {
        console.log('Failed to save ' + key);
        console.log(event);
        reject();
      }
      transaction.oncomplete = () => resolve(undefined);
    });
  }
}
