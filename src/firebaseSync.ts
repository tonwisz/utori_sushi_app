import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  getDocFromServer
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase App
export const app = initializeApp(firebaseConfig);
const firestoreDatabaseId = (firebaseConfig as any).firestoreDatabaseId;
export const db = firestoreDatabaseId ? getFirestore(app, firestoreDatabaseId) : getFirestore(app);

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

function sanitizeDocId(rawId: unknown, prefix = "item", idx = 0): string {
  if (rawId !== undefined && rawId !== null) {
    const cleaned = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, "_");
    if (cleaned.length > 0) return cleaned.slice(0, 128);
  }
  return `${prefix}-${Date.now()}-${idx}`;
}

function cleanPayload<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * SINKRONISASI DATA KE CLOUD FIRESTORE
 */
export async function syncConfigToFirestore(configData: any) {
  const path = 'settings/store_config';
  try {
    if (!configData || typeof configData !== 'object') return;
    await setDoc(doc(db, 'settings', 'store_config'), cleanPayload({
      ...configData,
      updatedAt: new Date().toISOString()
    }));
    console.log("Config saved to Firestore successfully");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncCategoriesToFirestore(categories: any[]) {
  const path = 'categories';
  try {
    if (!Array.isArray(categories)) return;
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      if (!cat || typeof cat !== 'object') continue;
      const docId = sanitizeDocId(cat.id, 'cat', i);
      await setDoc(doc(db, 'categories', docId), cleanPayload({ ...cat, id: docId, sortIndex: i }));
    }
    console.log("Categories saved to Firestore");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncProductsToFirestore(products: any[]) {
  const path = 'products';
  try {
    if (!Array.isArray(products)) return;
    for (let i = 0; i < products.length; i++) {
      const prod = products[i];
      if (!prod || typeof prod !== 'object') continue;
      const docId = sanitizeDocId(prod.id, 'prod', i);
      await setDoc(doc(db, 'products', docId), cleanPayload({ ...prod, id: docId, sortIndex: i }));
    }
    console.log("Products saved to Firestore");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncSingleProductToFirestore(product: any) {
  const docId = sanitizeDocId(product?.id, 'prod', 0);
  const path = `products/${docId}`;
  try {
    if (!product || typeof product !== 'object') return;
    await setDoc(doc(db, 'products', docId), cleanPayload({ ...product, id: docId }), { merge: true });
    console.log(`Product ${docId} synced directly to Firestore`);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncExtrasToFirestore(extras: any[]) {
  const path = 'extras';
  try {
    if (!Array.isArray(extras)) return;
    for (let i = 0; i < extras.length; i++) {
      const ext = extras[i];
      if (!ext || typeof ext !== 'object') continue;
      const docId = sanitizeDocId(ext.id, 'ext', i);
      await setDoc(doc(db, 'extras', docId), cleanPayload({ ...ext, id: docId, sortIndex: i }));
    }
    console.log("Extras saved to Firestore");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncPackagesToFirestore(packages: any[]) {
  const path = 'packages';
  try {
    if (!Array.isArray(packages)) return;
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      if (!pkg || typeof pkg !== 'object') continue;
      const docId = sanitizeDocId(pkg.id, 'pkg', i);
      await setDoc(doc(db, 'packages', docId), cleanPayload({ ...pkg, id: docId, sortIndex: i }));
    }
    console.log("Packages saved to Firestore");
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deletePackageFromFirestore(pkgId: string) {
  const docId = sanitizeDocId(pkgId, 'pkg', 0);
  const path = `packages/${docId}`;
  try {
    await deleteDoc(doc(db, 'packages', docId));
    console.log(`Package ${docId} deleted from Firestore`);
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
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

  // 5. Listen Packages (Menu Paket)
  const packagePath = 'packages';
  try {
    onSnapshot(collection(db, 'packages'), (snapshot) => {
      if (!snapshot.empty) {
        const pkgList: any[] = [];
        snapshot.forEach(d => pkgList.push(d.data()));
        if ((window as any).onFirestorePackagesUpdate) {
          (window as any).onFirestorePackagesUpdate(pkgList);
        }
      } else {
        if ((window as any).PACKAGE_MENUS) {
          syncPackagesToFirestore((window as any).PACKAGE_MENUS);
        }
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, packagePath);
    });
  } catch (err) {
    console.error("Packages onSnapshot failed", err);
  }
}

// Expose to window for vanilla JS application
(window as any).FirestoreSync = {
  db,
  app,
  projectId: firebaseConfig.projectId,
  databaseId: (firebaseConfig as any).firestoreDatabaseId || '(default)',
  syncConfigToFirestore,
  syncCategoriesToFirestore,
  syncProductsToFirestore,
  syncSingleProductToFirestore,
  syncExtrasToFirestore,
  syncPackagesToFirestore,
  deletePackageFromFirestore,
  initFirestoreDataSync
};

// Auto start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initFirestoreDataSync());
} else {
  initFirestoreDataSync();
}

