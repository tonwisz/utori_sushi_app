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
  getDocFromServer,
  Unsubscribe
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

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

export const ROLE_LEVELS: Record<string, number> = {
  owner: 5,
  super_admin: 5,
  superadmin: 5,
  pemilik: 5,
  admin: 4,
  branch_admin: 4,
  manager: 3,
  supervisor: 2,
  kasir: 1,
  cashier: 1,
  staff: 1
};

export function getRoleLevel(role?: string | null, explicitLevel?: unknown): number {
  if (typeof explicitLevel === 'number' && Number.isFinite(explicitLevel)) {
    return explicitLevel;
  }
  const key = String(role || '').trim().toLowerCase();
  return ROLE_LEVELS[key] ?? 1;
}

export function isManagerOrAbove(role?: string | null, explicitLevel?: unknown): boolean {
  return getRoleLevel(role, explicitLevel) >= 3;
}

export function sanitizeDocId(rawId: unknown, prefix = 'item', idx = 0): string {
  if (rawId !== undefined && rawId !== null) {
    const cleaned = String(rawId).trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    if (cleaned.length > 0) return cleaned.slice(0, 128);
  }
  return `${prefix}-${Date.now()}-${idx}`;
}

export function normalizeEmailKey(email: string): string {
  return sanitizeDocId(String(email || '').trim().toLowerCase(), 'acc', 0);
}

export function normalizeUsernameId(username: string): string {
  return sanitizeDocId(String(username || '').trim().toLowerCase(), 'user', 0);
}

function cleanPayload<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

async function sha256Hex(input: string): Promise<string> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    // ignore subtle crypto fallback
  }
  return '';
}

let currentActiveBranchId: string | null = null;
let branchScopedUnsubs: Unsubscribe[] = [];
let branchesListUnsub: Unsubscribe | null = null;

function updateFirestoreStatusUI(connected: boolean, message: string) {
  const detailBadge = document.getElementById('adminFirestoreInfo');
  if (detailBadge) {
    detailBadge.textContent = connected
      ? `Project: ${firebaseConfig.projectId} (Aktif & Sinkron)`
      : message || 'Menghubungkan...';
  }
  const footerBadge = document.getElementById('adminFirestoreFooterInfo');
  if (footerBadge) {
    footerBadge.textContent = connected
      ? `Database: ${firebaseConfig.projectId} · Multi-Cabang Aktif`
      : `Database: ${firebaseConfig.projectId} (${message})`;
  }
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    updateFirestoreStatusUI(true, 'Terhubung ke Cloud Firestore');
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
      updateFirestoreStatusUI(false, 'Offline');
    } else {
      updateFirestoreStatusUI(true, 'Terhubung ke Cloud Firestore');
    }
  }
}

export function getActiveBranchId(): string | null {
  return currentActiveBranchId;
}

export function setActiveBranchId(branchId: string | null) {
  currentActiveBranchId = branchId ? sanitizeDocId(branchId, 'branch', 0) : null;
}

// ============================================================================
// AKUN POS & USERNAME MULTI-CABANG (GATE LEVEL MANAGER KE ATAS)
// ============================================================================

export async function checkAccountsEmpty(): Promise<boolean> {
  try {
    const snap = await getDocs(collection(db, 'accounts'));
    return snap.empty;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, 'accounts');
    return false;
  }
}

export async function bootstrapOwnerAccount(params: {
  email: string;
  businessName?: string;
  username: string;
  pin: string;
  initialBranchName?: string;
}) {
  const email = String(params.email || '').trim().toLowerCase();
  const username = String(params.username || '').trim();
  const pin = String(params.pin || '').trim();
  if (!email || !username || !pin) {
    throw new Error('Email POS, Username, dan PIN wajib diisi.');
  }
  const existing = await getDocs(collection(db, 'accounts'));
  if (!existing.empty) {
    throw new Error('Akun POS sudah terdaftar. Silakan login menggunakan Email POS, Username, dan PIN yang terdaftar.');
  }

  const accountId = normalizeEmailKey(email);
  const usernameId = normalizeUsernameId(username);
  const pinHash = await sha256Hex(pin);
  const nowIso = new Date().toISOString();

  // Buat cabang pusat perdana jika branches masih kosong
  let centralBranchId = 'pusat';
  const branchSnap = await getDocs(collection(db, 'branches'));
  if (!branchSnap.empty) {
    centralBranchId = branchSnap.docs[0].id;
  } else {
    const branchName = (params.initialBranchName || params.businessName || 'Cabang Pusat').trim();
    const slug = branchName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pusat';
    await setDoc(doc(db, 'branches', centralBranchId), cleanPayload({
      id: centralBranchId,
      name: branchName,
      slug,
      isActive: true,
      isCentral: true,
      ownerEmail: email,
      whatsappNumber: '',
      address: '',
      mapsUrl: '',
      originLat: -6.200000,
      originLng: 106.816666,
      hours: '09.00 - 21.00 WIB',
      currencyLocale: 'id-ID',
      currencyCode: 'IDR',
      createdAt: nowIso,
      updatedAt: nowIso
    }));
  }

  await setDoc(doc(db, 'accounts', accountId), cleanPayload({
    accountId,
    email,
    businessName: (params.businessName || 'Bisnis Saya').trim(),
    isActive: true,
    centralBranchId,
    createdAt: nowIso,
    updatedAt: nowIso
  }));

  await setDoc(doc(db, 'accounts', accountId, 'users', usernameId), cleanPayload({
    username,
    displayName: username,
    pin,
    pinHash,
    role: 'owner',
    roleLevel: 5,
    branchIds: ['*'],
    isActive: true,
    source: 'web',
    createdAt: nowIso,
    updatedAt: nowIso
  }));

  return {
    accountId,
    email,
    username,
    role: 'owner',
    roleLevel: 5,
    isOwner: true,
    allowedBranchIds: ['*'],
    centralBranchId
  };
}

export async function verifyPosLogin(emailRaw: string, usernameRaw: string, pinRaw: string) {
  const email = String(emailRaw || '').trim().toLowerCase();
  const username = String(usernameRaw || '').trim();
  const pin = String(pinRaw || '').trim();

  if (!email || !username || !pin) {
    return { ok: false, code: 'EMPTY_FIELDS', message: 'Email POS, Username, dan PIN wajib diisi.' };
  }

  const candidateAccountId = normalizeEmailKey(email);
  let accountDocId: string | null = null;
  let accountData: any = null;

  try {
    const directSnap = await getDoc(doc(db, 'accounts', candidateAccountId));
    if (directSnap.exists()) {
      accountDocId = directSnap.id;
      accountData = directSnap.data();
    } else {
      const allAccounts = await getDocs(collection(db, 'accounts'));
      for (const d of allAccounts.docs) {
        const data = d.data();
        if (String(data?.email || '').trim().toLowerCase() === email) {
          accountDocId = d.id;
          accountData = data;
          break;
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `accounts/${candidateAccountId}`);
  }

  if (!accountDocId || !accountData) {
    return {
      ok: false,
      code: 'EMAIL_NOT_FOUND',
      message: 'Email belum terdaftar di POS Kasir. Daftarkan email di aplikasi POS terlebih dahulu.'
    };
  }

  if (accountData.isActive === false) {
    return {
      ok: false,
      code: 'ACCOUNT_INACTIVE',
      message: 'Akun bisnis ini sedang dinonaktifkan.'
    };
  }

  const candidateUsernameId = normalizeUsernameId(username);
  let userData: any = null;

  try {
    const directUserSnap = await getDoc(doc(db, 'accounts', accountDocId, 'users', candidateUsernameId));
    if (directUserSnap.exists()) {
      userData = directUserSnap.data();
    } else {
      const usersSnap = await getDocs(collection(db, 'accounts', accountDocId, 'users'));
      for (const d of usersSnap.docs) {
        const data = d.data();
        if (String(data?.username || '').trim().toLowerCase() === username.toLowerCase()) {
          userData = data;
          break;
        }
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, `accounts/${accountDocId}/users/${candidateUsernameId}`);
  }

  if (!userData) {
    return {
      ok: false,
      code: 'USER_NOT_FOUND',
      message: `Username "${username}" tidak ditemukan pada akun POS ${email}.`
    };
  }

  if (userData.isActive === false) {
    return {
      ok: false,
      code: 'USER_INACTIVE',
      message: `Username "${username}" sedang dinonaktifkan.`
    };
  }

  const inputPinHash = await sha256Hex(pin);
  const pinMatches =
    (typeof userData.pin === 'string' && userData.pin === pin) ||
    (typeof userData.pin === 'number' && String(userData.pin) === pin) ||
    (typeof userData.pinHash === 'string' && userData.pinHash.length > 0 && userData.pinHash === inputPinHash);

  if (!pinMatches) {
    return {
      ok: false,
      code: 'INVALID_PIN',
      message: 'PIN salah. Periksa kembali PIN username Anda.'
    };
  }

  const role = String(userData.role || 'kasir').trim().toLowerCase();
  const roleLevel = getRoleLevel(role, userData.roleLevel);

  // GATE WAJIB: Hanya level Manager ke atas (roleLevel >= 3) yang boleh login ke Website
  if (roleLevel < 3) {
    return {
      ok: false,
      code: 'ROLE_FORBIDDEN',
      message: `Akses ditolak: Level jabatan "${userData.role || 'Kasir'}" hanya untuk aplikasi POS Kasir. Login Website khusus level Manager ke atas.`
    };
  }

  const allowedBranchIds = Array.isArray(userData.branchIds) && userData.branchIds.length > 0
    ? userData.branchIds.map((b: unknown) => String(b))
    : (roleLevel >= 5 ? ['*'] : []);

  return {
    ok: true,
    accountId: accountDocId,
    email: accountData.email || email,
    businessName: accountData.businessName || '',
    centralBranchId: accountData.centralBranchId || null,
    username: userData.username || username,
    displayName: userData.displayName || userData.username || username,
    role,
    roleLevel,
    isOwner: roleLevel >= 5,
    allowedBranchIds
  };
}

export async function listAccountUsers(accountId: string) {
  const accId = sanitizeDocId(accountId, 'acc', 0);
  const path = `accounts/${accId}/users`;
  try {
    const snap = await getDocs(collection(db, 'accounts', accId, 'users'));
    const list: any[] = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      list.push({ ...data, id: d.id });
    });
    list.sort((a, b) => getRoleLevel(b.role, b.roleLevel) - getRoleLevel(a.role, a.roleLevel));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

export async function saveAccountUser(accountId: string, userObj: Record<string, any>) {
  const accId = sanitizeDocId(accountId, 'acc', 0);
  const username = String(userObj.username || '').trim();
  const usernameId = normalizeUsernameId(username);
  const path = `accounts/${accId}/users/${usernameId}`;
  try {
    const role = String(userObj.role || 'manager').trim().toLowerCase();
    const roleLevel = getRoleLevel(role, userObj.roleLevel);
    const pin = String(userObj.pin || '').trim();
    const pinHash = pin ? await sha256Hex(pin) : (userObj.pinHash || '');
    const payload: Record<string, any> = {
      username,
      displayName: String(userObj.displayName || username).trim(),
      role,
      roleLevel,
      branchIds: Array.isArray(userObj.branchIds) ? userObj.branchIds : [],
      isActive: userObj.isActive !== false,
      source: userObj.source || 'web',
      updatedAt: new Date().toISOString()
    };
    if (pin) {
      payload.pin = pin;
      payload.pinHash = pinHash;
    }
    await setDoc(doc(db, 'accounts', accId, 'users', usernameId), cleanPayload(payload), { merge: true });
    return usernameId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteAccountUser(accountId: string, usernameOrId: string) {
  const accId = sanitizeDocId(accountId, 'acc', 0);
  const userId = normalizeUsernameId(usernameOrId);
  const path = `accounts/${accId}/users/${userId}`;
  try {
    await deleteDoc(doc(db, 'accounts', accId, 'users', userId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

// ============================================================================
// MANAJEMEN CABANG & SALIN DARI PUSAT
// ============================================================================

export function listenBranches(callback: (branches: any[]) => void) {
  if (branchesListUnsub) {
    branchesListUnsub();
    branchesListUnsub = null;
  }
  try {
    branchesListUnsub = onSnapshot(
      collection(db, 'branches'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({ ...data, id: sanitizeDocId(data.id ?? d.id, 'branch', list.length) });
        });
        list.sort((a, b) => {
          if (Boolean(a.isCentral) !== Boolean(b.isCentral)) return a.isCentral ? -1 : 1;
          return String(a.name || '').localeCompare(String(b.name || ''));
        });
        callback(list);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'branches');
      }
    );
    return branchesListUnsub;
  } catch (err) {
    console.error('listenBranches error:', err);
    return null;
  }
}

export async function saveBranch(branchObj: Record<string, any>) {
  const branchId = sanitizeDocId(branchObj.id || branchObj.slug || branchObj.name, 'branch', 0);
  const path = `branches/${branchId}`;
  try {
    const slug = String(branchObj.slug || branchId)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '') || branchId;

    const payload = {
      ...branchObj,
      id: branchId,
      slug,
      name: String(branchObj.name || 'Cabang Baru').trim(),
      isActive: branchObj.isActive !== false,
      isCentral: Boolean(branchObj.isCentral),
      updatedAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'branches', branchId), cleanPayload(payload), { merge: true });
    return branchId;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteBranch(branchIdRaw: string) {
  const branchId = sanitizeDocId(branchIdRaw, 'branch', 0);
  const path = `branches/${branchId}`;
  try {
    const subcols = ['settings', 'categories', 'products', 'extras', 'packages', 'orders'];
    for (const sub of subcols) {
      const snap = await getDocs(collection(db, 'branches', branchId, sub));
      for (const d of snap.docs) {
        await deleteDoc(doc(db, 'branches', branchId, sub, d.id));
      }
    }
    await deleteDoc(doc(db, 'branches', branchId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function copyFromCentralBranch(
  centralBranchIdRaw: string,
  targetBranchIdRaw: string,
  options: { copyAppearance?: boolean; copyCatalog?: boolean } = { copyAppearance: true, copyCatalog: true }
) {
  const srcId = sanitizeDocId(centralBranchIdRaw, 'branch', 0);
  const dstId = sanitizeDocId(targetBranchIdRaw, 'branch', 0);
  if (!srcId || !dstId || srcId === dstId) {
    throw new Error('Cabang sumber dan cabang tujuan harus berbeda.');
  }

  try {
    if (options.copyAppearance !== false) {
      const appSnap = await getDoc(doc(db, 'branches', srcId, 'settings', 'appearance'));
      if (appSnap.exists()) {
        await setDoc(
          doc(db, 'branches', dstId, 'settings', 'appearance'),
          cleanPayload({ ...appSnap.data(), updatedAt: new Date().toISOString() }),
          { merge: true }
        );
      }
    }

    if (options.copyCatalog !== false) {
      const catalogCols = ['categories', 'products', 'extras', 'packages'];
      for (const colName of catalogCols) {
        const dstSnap = await getDocs(collection(db, 'branches', dstId, colName));
        for (const d of dstSnap.docs) {
          await deleteDoc(doc(db, 'branches', dstId, colName, d.id));
        }
        const srcSnap = await getDocs(collection(db, 'branches', srcId, colName));
        for (const d of srcSnap.docs) {
          await setDoc(doc(db, 'branches', dstId, colName, d.id), cleanPayload(d.data()));
        }
      }
      const srcCatListSnap = await getDoc(doc(db, 'branches', srcId, 'settings', 'categories'));
      if (srcCatListSnap.exists()) {
        await setDoc(doc(db, 'branches', dstId, 'settings', 'categories'), cleanPayload(srcCatListSnap.data()));
      }
    }
    return true;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `branches/${dstId}`);
    return false;
  }
}

// ============================================================================
// SINKRONISASI DATA PER-CABANG (THEME, COPY, CATEGORIES, PRODUCTS, EXTRAS, PACKAGES, ORDERS)
// ============================================================================

function resolveBranchId(branchId?: string | null): string {
  const bId = branchId || currentActiveBranchId;
  if (!bId) throw new Error('Cabang aktif belum dipilih.');
  return sanitizeDocId(bId, 'branch', 0);
}

export async function syncAppearanceToFirestore(appearanceData: any, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const path = `branches/${bId}/settings/appearance`;
  try {
    if (!appearanceData || typeof appearanceData !== 'object') return;
    await setDoc(
      doc(db, 'branches', bId, 'settings', 'appearance'),
      cleanPayload({ ...appearanceData, updatedAt: new Date().toISOString() }),
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncConfigToFirestore(configData: any, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const path = `branches/${bId}`;
  try {
    if (!configData || typeof configData !== 'object') return;
    await setDoc(
      doc(db, 'branches', bId),
      cleanPayload({
        ...configData,
        id: bId,
        updatedAt: new Date().toISOString()
      }),
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncCategoriesToFirestore(categories: any[], branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const path = `branches/${bId}/categories`;
  try {
    if (!Array.isArray(categories)) return;
    const activeIds = new Set<string>();
    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      if (!cat || typeof cat !== 'object') continue;
      const docId = sanitizeDocId(cat.id, 'cat', i);
      activeIds.add(docId);
      await setDoc(
        doc(db, 'branches', bId, 'categories', docId),
        cleanPayload({ ...cat, id: docId, sortIndex: i }),
        { merge: true }
      );
    }
    const existingSnaps = await getDocs(collection(db, 'branches', bId, 'categories'));
    for (const d of existingSnaps.docs) {
      if (!activeIds.has(d.id)) {
        await deleteDoc(doc(db, 'branches', bId, 'categories', d.id));
      }
    }
    const catNames = categories.map((c: any) => (c && c.name ? String(c.name).trim() : '')).filter(Boolean);
    await setDoc(
      doc(db, 'branches', bId, 'settings', 'categories'),
      cleanPayload({ list: catNames, updatedAt: Date.now() })
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteCategoryFromFirestore(catId: string, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const docId = sanitizeDocId(catId, 'cat', 0);
  const path = `branches/${bId}/categories/${docId}`;
  try {
    await deleteDoc(doc(db, 'branches', bId, 'categories', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncProductsToFirestore(products: any[], branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const path = `branches/${bId}/products`;
  try {
    if (!Array.isArray(products)) return;
    const activeIds = new Set<string>();
    for (let i = 0; i < products.length; i++) {
      const prod = products[i];
      if (!prod || typeof prod !== 'object') continue;
      const docId = sanitizeDocId(prod.id, 'prod', i);
      activeIds.add(docId);
      await setDoc(
        doc(db, 'branches', bId, 'products', docId),
        cleanPayload({ ...prod, id: docId, sortIndex: i }),
        { merge: true }
      );
    }
    const existingSnaps = await getDocs(collection(db, 'branches', bId, 'products'));
    for (const d of existingSnaps.docs) {
      if (!activeIds.has(d.id)) {
        await deleteDoc(doc(db, 'branches', bId, 'products', d.id));
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function syncSingleProductToFirestore(product: any, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const docId = sanitizeDocId(product?.id, 'prod', 0);
  const path = `branches/${bId}/products/${docId}`;
  try {
    if (!product || typeof product !== 'object') return;
    await setDoc(
      doc(db, 'branches', bId, 'products', docId),
      cleanPayload({ ...product, id: docId, updatedAt: product.updatedAt || Date.now() }),
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteProductFromFirestore(productId: string, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const docId = sanitizeDocId(productId, 'prod', 0);
  const path = `branches/${bId}/products/${docId}`;
  try {
    await deleteDoc(doc(db, 'branches', bId, 'products', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncExtrasToFirestore(extras: any[], branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const path = `branches/${bId}/extras`;
  try {
    if (!Array.isArray(extras)) return;
    const activeIds = new Set<string>();
    for (let i = 0; i < extras.length; i++) {
      const ext = extras[i];
      if (!ext || typeof ext !== 'object') continue;
      const docId = sanitizeDocId(ext.id, 'ext', i);
      activeIds.add(docId);
      await setDoc(
        doc(db, 'branches', bId, 'extras', docId),
        cleanPayload({ ...ext, id: docId, sortIndex: i })
      );
    }
    const existingSnaps = await getDocs(collection(db, 'branches', bId, 'extras'));
    for (const d of existingSnaps.docs) {
      if (!activeIds.has(d.id)) {
        await deleteDoc(doc(db, 'branches', bId, 'extras', d.id));
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deleteExtraFromFirestore(extraId: string, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const docId = sanitizeDocId(extraId, 'ext', 0);
  const path = `branches/${bId}/extras/${docId}`;
  try {
    await deleteDoc(doc(db, 'branches', bId, 'extras', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function syncPackagesToFirestore(packages: any[], branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const path = `branches/${bId}/packages`;
  try {
    if (!Array.isArray(packages)) return;
    const activeIds = new Set<string>();
    for (let i = 0; i < packages.length; i++) {
      const pkg = packages[i];
      if (!pkg || typeof pkg !== 'object') continue;
      const docId = sanitizeDocId(pkg.id, 'pkg', i);
      activeIds.add(docId);
      await setDoc(
        doc(db, 'branches', bId, 'packages', docId),
        cleanPayload({ ...pkg, id: docId, sortIndex: i })
      );
    }
    const existingSnaps = await getDocs(collection(db, 'branches', bId, 'packages'));
    for (const d of existingSnaps.docs) {
      if (!activeIds.has(d.id)) {
        await deleteDoc(doc(db, 'branches', bId, 'packages', d.id));
      }
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

export async function deletePackageFromFirestore(pkgId: string, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const docId = sanitizeDocId(pkgId, 'pkg', 0);
  const path = `branches/${bId}/packages/${docId}`;
  try {
    await deleteDoc(doc(db, 'branches', bId, 'packages', docId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

export async function submitOrderToFirestore(orderData: Record<string, any>, branchId?: string | null) {
  const bId = resolveBranchId(branchId);
  const docId = sanitizeDocId(orderData?.orderId || `ord-${Date.now()}`, 'ord', 0);
  const path = `branches/${bId}/orders/${docId}`;
  try {
    if (!orderData || typeof orderData !== 'object') {
      throw new Error('Data pesanan tidak valid');
    }
    const payload = cleanPayload({
      ...orderData,
      branchId: bId,
      orderId: docId,
      status: orderData.status || 'PENDING',
      timestamp: Number(orderData.timestamp) || Date.now()
    });
    await setDoc(doc(db, 'branches', bId, 'orders', docId), payload);
    return docId;
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function listenToOrderStatus(
  orderId: string,
  onStatusChange: (data: any, docId: string) => void,
  branchId?: string | null
) {
  const bId = resolveBranchId(branchId);
  const docId = sanitizeDocId(orderId, 'ord', 0);
  const path = `branches/${bId}/orders/${docId}`;
  try {
    return onSnapshot(
      doc(db, 'branches', bId, 'orders', docId),
      (snap) => {
        if (snap.exists() && typeof onStatusChange === 'function') {
          onStatusChange(snap.data(), docId);
        }
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  } catch (err) {
    console.error('listenToOrderStatus error:', err);
    return null;
  }
}

export function stopBranchListeners() {
  branchScopedUnsubs.forEach((unsub) => {
    try { unsub(); } catch {}
  });
  branchScopedUnsubs = [];
}

export function switchBranchListeners(branchId: string) {
  stopBranchListeners();
  const bId = sanitizeDocId(branchId, 'branch', 0);
  currentActiveBranchId = bId;

  // 1. Branch Profile
  branchScopedUnsubs.push(
    onSnapshot(
      doc(db, 'branches', bId),
      (snap) => {
        if (snap.exists() && (window as any).onFirestoreBranchProfileUpdate) {
          (window as any).onFirestoreBranchProfileUpdate({ ...snap.data(), id: snap.id });
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `branches/${bId}`)
    )
  );

  // 2. Branch Appearance (Theme + Copy + Brand)
  branchScopedUnsubs.push(
    onSnapshot(
      doc(db, 'branches', bId, 'settings', 'appearance'),
      (snap) => {
        if ((window as any).onFirestoreAppearanceUpdate) {
          (window as any).onFirestoreAppearanceUpdate(snap.exists() ? snap.data() : null, bId);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `branches/${bId}/settings/appearance`)
    )
  );

  // 3. Categories
  branchScopedUnsubs.push(
    onSnapshot(
      collection(db, 'branches', bId, 'categories'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({ ...data, id: sanitizeDocId(data.id ?? d.id, 'cat', list.length) });
        });
        list.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
        if ((window as any).onFirestoreCategoriesUpdate) {
          (window as any).onFirestoreCategoriesUpdate(list, bId);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `branches/${bId}/categories`)
    )
  );

  branchScopedUnsubs.push(
    onSnapshot(
      doc(db, 'branches', bId, 'settings', 'categories'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data && Array.isArray(data.list) && (window as any).onFirestoreAndroidCategoriesList) {
            (window as any).onFirestoreAndroidCategoriesList(data.list, bId);
          }
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `branches/${bId}/settings/categories`)
    )
  );

  // 4. Products
  branchScopedUnsubs.push(
    onSnapshot(
      collection(db, 'branches', bId, 'products'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({ ...data, id: sanitizeDocId(data.id ?? d.id, 'prod', list.length) });
        });
        list.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
        if ((window as any).onFirestoreProductsUpdate) {
          (window as any).onFirestoreProductsUpdate(list, bId);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `branches/${bId}/products`)
    )
  );

  // 5. Extras
  branchScopedUnsubs.push(
    onSnapshot(
      collection(db, 'branches', bId, 'extras'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({ ...data, id: sanitizeDocId(data.id ?? d.id, 'ext', list.length) });
        });
        list.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
        if ((window as any).onFirestoreExtrasUpdate) {
          (window as any).onFirestoreExtrasUpdate(list, bId);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `branches/${bId}/extras`)
    )
  );

  // 6. Packages
  branchScopedUnsubs.push(
    onSnapshot(
      collection(db, 'branches', bId, 'packages'),
      (snap) => {
        const list: any[] = [];
        snap.forEach((d) => {
          const data = d.data() || {};
          list.push({ ...data, id: sanitizeDocId(data.id ?? d.id, 'pkg', list.length) });
        });
        list.sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0));
        if ((window as any).onFirestorePackagesUpdate) {
          (window as any).onFirestorePackagesUpdate(list, bId);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `branches/${bId}/packages`)
    )
  );
}

export function initFirestoreDataSync() {
  testConnection();
}

(window as any).FirestoreSync = {
  db,
  app,
  projectId: firebaseConfig.projectId,
  databaseId: (firebaseConfig as any).firestoreDatabaseId || '(default)',
  ROLE_LEVELS,
  getRoleLevel,
  isManagerOrAbove,
  normalizeEmailKey,
  normalizeUsernameId,
  checkAccountsEmpty,
  bootstrapOwnerAccount,
  verifyPosLogin,
  listAccountUsers,
  saveAccountUser,
  deleteAccountUser,
  listenBranches,
  saveBranch,
  deleteBranch,
  copyFromCentralBranch,
  getActiveBranchId,
  setActiveBranchId,
  switchBranchListeners,
  stopBranchListeners,
  syncAppearanceToFirestore,
  syncConfigToFirestore,
  syncCategoriesToFirestore,
  deleteCategoryFromFirestore,
  syncProductsToFirestore,
  syncSingleProductToFirestore,
  deleteProductFromFirestore,
  syncExtrasToFirestore,
  deleteExtraFromFirestore,
  syncPackagesToFirestore,
  deletePackageFromFirestore,
  submitOrderToFirestore,
  listenToOrderStatus,
  initFirestoreDataSync
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => initFirestoreDataSync());
} else {
  initFirestoreDataSync();
}
