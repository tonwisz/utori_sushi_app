import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Validasi Koneksi ke Firestore saat awal boot (sesuai SKILL.md)
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firebase Firestore connected successfully!");
    updateFirestoreStatusUI(true, "Terhubung ke Firebase Firestore");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
      updateFirestoreStatusUI(false, "Firestore Offline / Belum Terkoneksi");
    } else {
      // Permission denied atau not found pada test doc adalah normal dan membuktikan server merespon
      updateFirestoreStatusUI(true, "Terhubung ke Firebase Firestore");
    }
  }
}

function updateFirestoreStatusUI(connected: boolean, message: string) {
  const badge = document.getElementById("firestoreStatusBadge");
  if (badge) {
    badge.innerHTML = `
      <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${
        connected ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
      }">
        <span class="w-1.5 h-1.5 rounded-full ${connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}"></span>
        <span>${message}</span>
      </span>
    `;
  }
  const detailBadge = document.getElementById("adminFirestoreInfo");
  if (detailBadge) {
    detailBadge.textContent = connected
      ? `Project: ${firebaseConfig.projectId} (Aktif & Sinkron)`
      : "Menghubungkan...";
  }
}

/**
 * SINKRONISASI DATA KE CLOUD FIRESTORE
 */
export async function syncConfigToFirestore(configData: any) {
  const path = 'settings/store_config';
  try {
    await setDoc(doc(db, 'settings', 'store_config'), {
      ...configData,
      updatedAt: new Date().toISOString()
    });
    console.log("Config saved to Firestore successfully");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncCategoriesToFirestore(categories: any[]) {
  const path = 'categories';
  try {
    for (const cat of categories) {
      await setDoc(doc(db, 'categories', cat.id), cat);
    }
    console.log("Categories saved to Firestore");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncProductsToFirestore(products: any[]) {
  const path = 'products';
  try {
    for (const prod of products) {
      await setDoc(doc(db, 'products', prod.id), prod);
    }
    console.log("Products saved to Firestore");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncSingleProductToFirestore(product: any) {
  const path = `products/${product.id}`;
  try {
    await setDoc(doc(db, 'products', product.id), product, { merge: true });
    console.log(`Product ${product.id} synced directly to Firestore`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncExtrasToFirestore(extras: any[]) {
  const path = 'extras';
  try {
    for (const ext of extras) {
      await setDoc(doc(db, 'extras', ext.id), ext);
    }
    console.log("Extras saved to Firestore");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * INITIAL LOAD & REAL-TIME LISTENER
 */
export function initFirestoreDataSync() {
  testConnection();

  // 1. Listen Store Config
  const configPath = 'settings';
  try {
    onSnapshot(doc(db, 'settings', 'store_config'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if ((window as any).onFirestoreConfigUpdate) {
          (window as any).onFirestoreConfigUpdate(data);
        }
      } else {
        // Jika belum ada di Firestore, seed dari local default
        if ((window as any).CONFIG) {
          syncConfigToFirestore((window as any).CONFIG);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, configPath);
    });
  } catch (err) {
    console.error("Config onSnapshot failed", err);
  }

  // 2. Listen Categories
  const catPath = 'categories';
  try {
    onSnapshot(collection(db, 'categories'), (snapshot) => {
      if (!snapshot.empty) {
        const cats: any[] = [];
        snapshot.forEach(d => cats.push(d.data()));
        if ((window as any).onFirestoreCategoriesUpdate) {
          (window as any).onFirestoreCategoriesUpdate(cats);
        }
      } else {
        if ((window as any).CATEGORIES) {
          syncCategoriesToFirestore((window as any).CATEGORIES);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, catPath);
    });
  } catch (err) {
    console.error("Categories onSnapshot failed", err);
  }

  // 3. Listen Products
  const prodPath = 'products';
  try {
    onSnapshot(collection(db, 'products'), (snapshot) => {
      if (!snapshot.empty) {
        const prods: any[] = [];
        snapshot.forEach(d => prods.push(d.data()));
        if ((window as any).onFirestoreProductsUpdate) {
          (window as any).onFirestoreProductsUpdate(prods);
        }
      } else {
        if ((window as any).PRODUCTS) {
          syncProductsToFirestore((window as any).PRODUCTS);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, prodPath);
    });
  } catch (err) {
    console.error("Products onSnapshot failed", err);
  }

  // 4. Listen Extras
  const extraPath = 'extras';
  try {
    onSnapshot(collection(db, 'extras'), (snapshot) => {
      if (!snapshot.empty) {
        const extList: any[] = [];
        snapshot.forEach(d => extList.push(d.data()));
        if ((window as any).onFirestoreExtrasUpdate) {
          (window as any).onFirestoreExtrasUpdate(extList);
        }
      } else {
        if ((window as any).EXTRAS) {
          syncExtrasToFirestore((window as any).EXTRAS);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, extraPath);
    });
  } catch (err) {
    console.error("Extras onSnapshot failed", err);
  }
}

// Expose to window for vanilla JS application
(window as any).FirestoreSync = {
  db,
  app,
  projectId: firebaseConfig.projectId,
  databaseId: firebaseConfig.firestoreDatabaseId,
  syncConfigToFirestore,
  syncCategoriesToFirestore,
  syncProductsToFirestore,
  syncSingleProductToFirestore,
  syncExtrasToFirestore,
  initFirestoreDataSync
};

// Auto start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initFirestoreDataSync());
} else {
  initFirestoreDataSync();
}
