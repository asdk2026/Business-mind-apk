import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  Auth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile,
  setPersistence,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocFromServer,
  setDoc,
  updateDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  writeBatch,
  Firestore,
  Unsubscribe,
} from 'firebase/firestore';
import {
  Product,
  Customer,
  Supplier,
  Invoice,
  Purchase,
  StockMovement,
  PaymentRecord,
  Expense,
  BusinessSettings,
  UserAccount,
  FirebaseUserRole,
  UserPermissions,
  SyncQueueItem,
  ConflictRecord,
} from '../types';
import {
  ROOT_ADMIN_EMAIL,
  ADMIN_PERMISSIONS,
  normalizePermissions,
} from './permissions';
import {
  STORAGE_KEYS,
  getLocal,
  setLocal,
  QueuedCloudDeletion,
} from './db';

export const firebaseConfig = {
  apiKey: "AIzaSyDrOkYT_9cCZ7drK4WtsjNn4PVxWpuGBiU",
  authDomain: "pwa-7900d.firebaseapp.com",
  projectId: "pwa-7900d",
  storageBucket: "pwa-7900d.firebasestorage.app",
  messagingSenderId: "513108948757",
  appId: "1:513108948757:web:82ec4821640f7b70e2db1c",
  measurementId: "G-TCZP4V0ZSB",
};

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
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const auth = getFirebaseAuth();
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  return errInfo;
}

let appInstance: FirebaseApp | null = null;
let secondaryAppInstance: FirebaseApp | null = null;
let firestoreInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let secondaryAuthInstance: Auth | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!appInstance) {
    const existing = getApps().find((a) => a.name === '[DEFAULT]');
    appInstance = existing || initializeApp(firebaseConfig);
  }
  return appInstance;
}

export function getSecondaryFirebaseApp(): FirebaseApp {
  if (!secondaryAppInstance) {
    const existing = getApps().find((a) => a.name === 'AdminWorkerApp');
    secondaryAppInstance = existing || initializeApp(firebaseConfig, 'AdminWorkerApp');
  }
  return secondaryAppInstance;
}

export function getFirebaseFirestore(): Firestore {
  if (!firestoreInstance) {
    const app = getFirebaseApp();
    try {
      firestoreInstance = initializeFirestore(app, {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      });
    } catch {
      firestoreInstance = getFirestore(app);
    }
  }
  return firestoreInstance;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
    setPersistence(authInstance, indexedDBLocalPersistence).catch(() => {
      if (authInstance) {
        setPersistence(authInstance, browserLocalPersistence).catch(() => {});
      }
    });
  }
  return authInstance;
}

export function getSecondaryFirebaseAuth(): Auth {
  if (!secondaryAuthInstance) {
    secondaryAuthInstance = getAuth(getSecondaryFirebaseApp());
  }
  return secondaryAuthInstance;
}

export function getCachedAuthUser(uid?: string): UserAccount | null {
  const cached = getLocal<UserAccount | null>(STORAGE_KEYS.CACHED_AUTH_USER, null);
  if (!cached || !cached.isActive) return null;
  if (uid && cached.uid !== uid) return null;
  return {
    ...cached,
    permissions: normalizePermissions(cached.role, cached.permissions),
  };
}

export function getAnyCachedAuthUser(): UserAccount | null {
  return getCachedAuthUser(undefined);
}

export function setCachedAuthUser(user: UserAccount | null): void {
  if (!user) {
    try {
      localStorage.removeItem(STORAGE_KEYS.CACHED_AUTH_USER);
      setLocal(STORAGE_KEYS.CACHED_AUTH_USER, null);
    } catch {
      // ignore
    }
    return;
  }
  setLocal(STORAGE_KEYS.CACHED_AUTH_USER, user);
}

function isOfflineOrNetworkError(error: any): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  const code = String(error?.code || '').toLowerCase();
  const msg = String(error?.message || '').toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    code === 'auth/network-request-failed' ||
    msg.includes('offline') ||
    msg.includes('unavailable') ||
    msg.includes('network')
  );
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    const db = getFirebaseFirestore();
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firestore is offline or unreachable; offline cache mode active.');
    }
    return false;
  }
}

function sanitizeEmailKey(email: string): string {
  return email.toLowerCase().trim().replace(/[^a-z0-9@._-]/g, '_');
}

export function formatFirebaseAuthError(error: any): string {
  const code = error?.code || '';
  const msg = error?.message || 'Authentication error occurred.';
  if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
    return 'Invalid email or password. Please verify your credentials or ask Admin.';
  }
  if (code === 'auth/email-already-in-use') {
    return 'An account with this email already exists in Firebase Authentication.';
  }
  if (code === 'auth/weak-password') {
    return 'Password is too weak. Please use at least 6 characters.';
  }
  if (code === 'auth/operation-not-allowed') {
    return 'Email/Password or Google sign-in is not enabled in Firebase Console (Authentication → Sign-in method).';
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Google sign-in popup was closed before completion.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many failed attempts. Please wait a moment and try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error. Please check your internet connection.';
  }
  return msg;
}

/**
 * Ensures the signed-in Firebase Auth user is authorized in Firestore.
 * Only ROOT_ADMIN_EMAIL can auto-bootstrap; all other users MUST already have
 * a Firestore profile in `users/{uid}` or an Admin pre-authorization in `invited_users/{email}`.
 */
export async function resolveAuthorizedUserProfile(fbUser: FirebaseUser): Promise<UserAccount> {
  const cached = getCachedAuthUser(fbUser.uid);

  // If offline right now, seamlessly allow previously authorized user via local cache
  if (typeof navigator !== 'undefined' && !navigator.onLine && cached) {
    return cached;
  }

  const db = getFirebaseFirestore();
  const userEmail = (fbUser.email || '').toLowerCase().trim();
  const userRef = doc(db, 'users', fbUser.uid);

  try {
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data() as UserAccount;
      const normalized: UserAccount = {
        ...data,
        uid: fbUser.uid,
        email: userEmail || data.email,
        permissions: normalizePermissions(data.role, data.permissions),
      };
      if (!normalized.isActive) {
        setCachedAuthUser(null);
        await signOut(getFirebaseAuth());
        throw new Error('Your account has been disabled by an Administrator.');
      }
      setCachedAuthUser(normalized);
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await updateDoc(userRef, {
          last_login: new Date().toISOString(),
        }).catch(() => {});
      }
      return normalized;
    }

    if (snap.metadata?.fromCache && cached) {
      return cached;
    }

    // Root Admin bootstrap on first sign-in
    if (userEmail === ROOT_ADMIN_EMAIL) {
      const now = new Date().toISOString();
      const adminProfile: UserAccount = {
        uid: fbUser.uid,
        name: fbUser.displayName || 'Primary Admin',
        email: ROOT_ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        permissions: structuredClone(ADMIN_PERMISSIONS),
        created_at: now,
        created_by: 'system_root',
        updated_at: now,
        last_login: now,
      };
      await setDoc(userRef, adminProfile);
      await setDoc(doc(db, 'admins', fbUser.uid), {
        uid: fbUser.uid,
        email: ROOT_ADMIN_EMAIL,
        created_at: now,
      });
      setCachedAuthUser(adminProfile);
      return adminProfile;
    }

    // Check if Admin pre-authorized this email
    if (userEmail) {
      const inviteRef = doc(db, 'invited_users', sanitizeEmailKey(userEmail));
      const inviteSnap = await getDoc(inviteRef);
      if (inviteSnap.exists()) {
        const invite = inviteSnap.data() as Partial<UserAccount>;
        const role: FirebaseUserRole = invite.role || 'user';
        const now = new Date().toISOString();
        const newProfile: UserAccount = {
          uid: fbUser.uid,
          name: fbUser.displayName || invite.name || userEmail.split('@')[0],
          email: userEmail,
          phone: invite.phone || '',
          role,
          isActive: invite.isActive !== false,
          permissions: normalizePermissions(role, invite.permissions),
          created_at: invite.created_at || now,
          created_by: invite.created_by || 'admin',
          updated_at: now,
          last_login: now,
        };
        await setDoc(userRef, newProfile);
        if (role === 'admin') {
          await setDoc(doc(db, 'admins', fbUser.uid), {
            uid: fbUser.uid,
            email: userEmail,
            created_at: now,
          });
        }
        await deleteDoc(inviteRef).catch(() => {});
        setCachedAuthUser(newProfile);
        return newProfile;
      }
    }

    // Unauthorized: nobody except Admin can create accounts
    setCachedAuthUser(null);
    await signOut(getFirebaseAuth());
    throw new Error(
      'Access Denied: Public registration is disabled. Only an Admin can create or authorize accounts.'
    );
  } catch (err: any) {
    if (cached && isOfflineOrNetworkError(err)) {
      return cached;
    }
    throw err;
  }
}

export async function signInWithFirebaseEmail(email: string, password: string): Promise<UserAccount> {
  try {
    const auth = getFirebaseAuth();
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    return await resolveAuthorizedUserProfile(cred.user);
  } catch (err: any) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function signInWithFirebaseGoogle(): Promise<UserAccount> {
  try {
    const auth = getFirebaseAuth();
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(auth, provider);
    return await resolveAuthorizedUserProfile(cred.user);
  } catch (err: any) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

/**
 * One-time Root Admin Initial Setup strictly restricted to ROOT_ADMIN_EMAIL.
 */
export async function bootstrapRootAdminAccount(
  email: string,
  password: string,
  name: string
): Promise<UserAccount> {
  const cleanEmail = email.toLowerCase().trim();
  if (cleanEmail !== ROOT_ADMIN_EMAIL) {
    throw new Error(
      `Only the designated Root Admin (${ROOT_ADMIN_EMAIL}) can initialize the system.`
    );
  }
  try {
    const auth = getFirebaseAuth();
    const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
    if (name.trim()) {
      await updateProfile(cred.user, { displayName: name.trim() });
    }
    const db = getFirebaseFirestore();
    const now = new Date().toISOString();
    const adminProfile: UserAccount = {
      uid: cred.user.uid,
      name: name.trim() || 'Primary Admin',
      email: cleanEmail,
      role: 'admin',
      isActive: true,
      permissions: structuredClone(ADMIN_PERMISSIONS),
      created_at: now,
      created_by: 'system_root',
      updated_at: now,
      last_login: now,
    };
    await setDoc(doc(db, 'users', cred.user.uid), adminProfile);
    await setDoc(doc(db, 'admins', cred.user.uid), {
      uid: cred.user.uid,
      email: cleanEmail,
      created_at: now,
    });
    setCachedAuthUser(adminProfile);
    return adminProfile;
  } catch (err: any) {
    throw new Error(formatFirebaseAuthError(err));
  }
}

export async function signOutFirebase(): Promise<void> {
  setCachedAuthUser(null);
  setLocal(STORAGE_KEYS.CACHED_USERS_LIST, []);
  const auth = getFirebaseAuth();
  await signOut(auth);
}

/**
 * Admin-only: Create a new User / Manager / Admin in Firebase Auth + Firestore
 * using a secondary Firebase App instance so the Admin's session stays intact.
 */
export async function createStaffUserByAdmin(params: {
  name: string;
  email: string;
  password: string;
  phone?: string;
  role: FirebaseUserRole;
  permissions: UserPermissions;
  adminUid: string;
}): Promise<UserAccount> {
  const cleanEmail = params.email.toLowerCase().trim();
  const secondaryAuth = getSecondaryFirebaseAuth();
  const db = getFirebaseFirestore();
  const now = new Date().toISOString();

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, cleanEmail, params.password);
    if (params.name.trim()) {
      await updateProfile(cred.user, { displayName: params.name.trim() });
    }

    const newUid = cred.user.uid;
    const normalizedPerms = normalizePermissions(params.role, params.permissions);

    const newAccount: UserAccount = {
      uid: newUid,
      name: params.name.trim(),
      email: cleanEmail,
      phone: params.phone?.trim() || '',
      role: params.role,
      isActive: true,
      permissions: normalizedPerms,
      created_at: now,
      created_by: params.adminUid,
      updated_at: now,
    };

    await setDoc(doc(db, 'users', newUid), newAccount);
    if (params.role === 'admin') {
      await setDoc(doc(db, 'admins', newUid), {
        uid: newUid,
        email: cleanEmail,
        created_at: now,
      });
    }

    await signOut(secondaryAuth);
    return newAccount;
  } catch (err: any) {
    await signOut(secondaryAuth).catch(() => {});
    throw new Error(formatFirebaseAuthError(err));
  }
}

/**
 * Admin-only: Update an existing user's role, active state, name, phone, or granular permissions.
 */
export async function updateStaffUserByAdmin(
  uid: string,
  updates: Partial<Pick<UserAccount, 'name' | 'phone' | 'role' | 'isActive' | 'permissions'>>
): Promise<void> {
  const db = getFirebaseFirestore();
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    throw new Error('User record not found in Firestore.');
  }

  const existing = snap.data() as UserAccount;
  const nextRole = updates.role ?? existing.role;
  const nextPerms = normalizePermissions(nextRole, updates.permissions ?? existing.permissions);
  const now = new Date().toISOString();

  await updateDoc(userRef, {
    ...(updates.name !== undefined ? { name: updates.name.trim() } : {}),
    ...(updates.phone !== undefined ? { phone: updates.phone.trim() } : {}),
    ...(updates.isActive !== undefined ? { isActive: updates.isActive } : {}),
    role: nextRole,
    permissions: nextPerms,
    updated_at: now,
  });

  const adminRef = doc(db, 'admins', uid);
  if (nextRole === 'admin') {
    await setDoc(adminRef, {
      uid,
      email: existing.email,
      updated_at: now,
    });
  } else {
    await deleteDoc(adminRef).catch(() => {});
  }
}

/**
 * Admin-only: Revoke and delete a staff user's Firestore access profile.
 */
export async function deleteStaffUserByAdmin(uid: string): Promise<void> {
  const db = getFirebaseFirestore();
  await deleteDoc(doc(db, 'users', uid));
  await deleteDoc(doc(db, 'admins', uid)).catch(() => {});
}

export function subscribeToCurrentUserProfile(
  uid: string,
  onUpdate: (user: UserAccount | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const db = getFirebaseFirestore();
  const userRef = doc(db, 'users', uid);
  return onSnapshot(
    userRef,
    (snap) => {
      if (!snap.exists()) {
        // Never kick an authenticated offline user based on an empty local cache snapshot
        if (snap.metadata.fromCache && (typeof navigator !== 'undefined' && !navigator.onLine || Boolean(getCachedAuthUser(uid)))) {
          return;
        }
        setCachedAuthUser(null);
        onUpdate(null);
        return;
      }
      const data = snap.data() as UserAccount;
      const normalized: UserAccount = {
        ...data,
        uid,
        permissions: normalizePermissions(data.role, data.permissions),
      };
      if (normalized.isActive) {
        setCachedAuthUser(normalized);
      } else {
        setCachedAuthUser(null);
      }
      onUpdate(normalized);
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${uid}`);
      if (onError) onError(error);
    }
  );
}

export function subscribeToAllUsers(
  onUpdate: (users: UserAccount[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const db = getFirebaseFirestore();
  const usersRef = collection(db, 'users');
  return onSnapshot(
    usersRef,
    (snap) => {
      const list: UserAccount[] = [];
      snap.forEach((d) => {
        const data = d.data() as UserAccount;
        list.push({
          ...data,
          uid: d.id,
          permissions: normalizePermissions(data.role, data.permissions),
        });
      });
      list.sort((a, b) => {
        const order = { admin: 0, manager: 1, user: 2 };
        return (order[a.role] ?? 3) - (order[b.role] ?? 3);
      });
      if (list.length > 0) {
        setLocal(STORAGE_KEYS.CACHED_USERS_LIST, list);
      }
      onUpdate(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
      if (onError) onError(error);
    }
  );
}

type BatchOp =
  | { type: 'set'; collectionName: string; docId: string; data: any }
  | { type: 'delete'; collectionName: string; docId: string };

async function commitOperationsInChunks(db: Firestore, ops: BatchOp[]): Promise<void> {
  const CHUNK_SIZE = 400;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const op of chunk) {
      const ref = doc(db, op.collectionName, op.docId);
      if (op.type === 'set') {
        batch.set(ref, op.data);
      } else {
        batch.delete(ref);
      }
    }
    await batch.commit();
  }
}

/**
 * Conflict Handler: Compares Record Version first, then Last Updated ISO timestamp.
 */
export function resolveRecordConflict<
  T extends {
    id: string;
    version?: number;
    updated_at?: string;
    created_at?: string;
    date?: string;
    timestamp?: string;
  }
>(
  collectionName: string,
  localItem: T,
  cloudItem: T
): { chosen: T; conflict?: ConflictRecord } {
  const localVersion = Number(localItem.version) || 1;
  const cloudVersion = Number(cloudItem.version) || 1;

  const localUpdatedAt =
    localItem.updated_at || localItem.created_at || localItem.date || localItem.timestamp || '';
  const cloudUpdatedAt =
    cloudItem.updated_at || cloudItem.created_at || cloudItem.date || cloudItem.timestamp || '';

  const localTs = Date.parse(localUpdatedAt) || 0;
  const cloudTs = Date.parse(cloudUpdatedAt) || 0;

  let winner: 'local' | 'cloud' = 'local';
  if (cloudVersion > localVersion) {
    winner = 'cloud';
  } else if (cloudVersion === localVersion && cloudTs > localTs) {
    winner = 'cloud';
  }

  const chosen = winner === 'cloud' ? cloudItem : localItem;

  // Detect real divergence if timestamps/versions differ and serialized payloads aren't identical
  const localStr = JSON.stringify({ ...localItem, version: undefined, updated_at: undefined });
  const cloudStr = JSON.stringify({ ...cloudItem, version: undefined, updated_at: undefined });
  if ((localVersion !== cloudVersion || localTs !== cloudTs) && localStr !== cloudStr) {
    return {
      chosen,
      conflict: {
        id: `conf_${collectionName}_${localItem.id}_${Date.now()}`,
        collection: collectionName,
        docId: localItem.id,
        localVersion,
        cloudVersion,
        localUpdatedAt,
        cloudUpdatedAt,
        winner,
        resolvedAt: new Date().toISOString(),
      },
    };
  }

  return { chosen };
}

/**
 * Flush queued background sync operations stored in SQLite sync_queue to Firestore
 */
export async function flushSyncQueueToFirebase(
  queue: SyncQueueItem[]
): Promise<{ success: boolean; processedIds: string[]; error?: string }> {
  if (queue.length === 0) {
    return { success: true, processedIds: [] };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { success: false, processedIds: [], error: 'Offline' };
  }

  try {
    const db = getFirebaseFirestore();
    const ops: BatchOp[] = [];
    const processedIds: string[] = [];

    for (const item of queue) {
      if (item.op_type === 'delete') {
        ops.push({
          type: 'delete',
          collectionName: item.collection_name,
          docId: item.doc_id,
        });
        processedIds.push(item.op_id);
      } else if (item.payload_json) {
        try {
          const parsed = JSON.parse(item.payload_json);
          ops.push({
            type: 'set',
            collectionName: item.collection_name,
            docId: item.doc_id,
            data: {
              ...parsed,
              version: item.version || parsed.version || 1,
              updated_at: item.updated_at || parsed.updated_at || new Date().toISOString(),
            },
          });
          processedIds.push(item.op_id);
        } catch {
          // Skip unparseable payload cleanly
          processedIds.push(item.op_id);
        }
      }
    }

    if (ops.length > 0) {
      await commitOperationsInChunks(db, ops);
    }
    return { success: true, processedIds };
  } catch (err: any) {
    handleFirestoreError(err, OperationType.WRITE, 'sync_queue_flush');
    return {
      success: false,
      processedIds: [],
      error: err?.message || 'Queue sync failed',
    };
  }
}

/**
 * Sync entire local state (all collections, chunked safely) to Cloud Firebase Firestore
 */
export async function syncStoreToFirebase(payload: {
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  purchases: Purchase[];
  stockMovements: StockMovement[];
  payments: PaymentRecord[];
  expenses: Expense[];
  categories: string[];
  settings: BusinessSettings;
  deletedRefs?: QueuedCloudDeletion[];
}): Promise<{ success: boolean; message: string; syncedAt: string }> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      success: false,
      message: 'Offline mode active. Changes are saved locally and will auto-sync when online.',
      syncedAt: new Date().toISOString(),
    };
  }

  try {
    const db = getFirebaseFirestore();
    const ops: BatchOp[] = [];

    ops.push({
      type: 'set',
      collectionName: 'system',
      docId: 'business_settings',
      data: {
        ...payload.settings,
        updated_at_cloud: new Date().toISOString(),
      },
    });

    ops.push({
      type: 'set',
      collectionName: 'system',
      docId: 'categories',
      data: {
        list: payload.categories,
        updated_at_cloud: new Date().toISOString(),
      },
    });

    payload.products.forEach((prod) => {
      ops.push({ type: 'set', collectionName: 'products', docId: prod.id, data: prod });
    });

    payload.customers.forEach((cust) => {
      ops.push({ type: 'set', collectionName: 'customers', docId: cust.id, data: cust });
    });

    payload.suppliers.forEach((supp) => {
      ops.push({ type: 'set', collectionName: 'suppliers', docId: supp.id, data: supp });
    });

    payload.invoices.forEach((inv) => {
      ops.push({ type: 'set', collectionName: 'invoices', docId: inv.id, data: inv });
    });

    payload.purchases.forEach((pur) => {
      ops.push({ type: 'set', collectionName: 'purchases', docId: pur.id, data: pur });
    });

    payload.stockMovements.forEach((mov) => {
      ops.push({ type: 'set', collectionName: 'stock_movements', docId: mov.id, data: mov });
    });

    payload.payments.forEach((pay) => {
      ops.push({ type: 'set', collectionName: 'payments', docId: pay.id, data: pay });
    });

    payload.expenses.forEach((exp) => {
      ops.push({ type: 'set', collectionName: 'expenses', docId: exp.id, data: exp });
    });

    if (payload.deletedRefs && payload.deletedRefs.length > 0) {
      payload.deletedRefs.forEach((del) => {
        if (del.collection && del.id) {
          ops.push({ type: 'delete', collectionName: del.collection, docId: del.id });
        }
      });
    }

    await commitOperationsInChunks(db, ops);

    return {
      success: true,
      message: `Successfully synchronized ${payload.products.length} products, ${payload.invoices.length} invoices, and all business records to Firebase project ${firebaseConfig.projectId}`,
      syncedAt: new Date().toISOString(),
    };
  } catch (error: any) {
    handleFirestoreError(error, OperationType.WRITE, 'batch_sync');
    return {
      success: false,
      message: error?.message || 'Firebase sync failed. Please verify Firestore rules and connectivity.',
      syncedAt: new Date().toISOString(),
    };
  }
}

/**
 * Fetch and restore ALL store collections from Cloud Firebase Firestore
 */
export async function fetchStoreFromFirebase(): Promise<{
  success: boolean;
  data?: {
    products?: Product[];
    customers?: Customer[];
    suppliers?: Supplier[];
    invoices?: Invoice[];
    purchases?: Purchase[];
    stockMovements?: StockMovement[];
    payments?: PaymentRecord[];
    expenses?: Expense[];
    categories?: string[];
    settings?: BusinessSettings;
  };
  message: string;
}> {
  try {
    const db = getFirebaseFirestore();

    const [
      prodSnap,
      custSnap,
      suppSnap,
      invSnap,
      purSnap,
      movSnap,
      paySnap,
      expSnap,
      sysSnap,
    ] = await Promise.all([
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'customers')),
      getDocs(collection(db, 'suppliers')),
      getDocs(collection(db, 'invoices')),
      getDocs(collection(db, 'purchases')),
      getDocs(collection(db, 'stock_movements')),
      getDocs(collection(db, 'payments')),
      getDocs(collection(db, 'expenses')),
      getDocs(collection(db, 'system')),
    ]);

    const products: Product[] = [];
    prodSnap.forEach((d) => products.push(d.data() as Product));

    const customers: Customer[] = [];
    custSnap.forEach((d) => customers.push(d.data() as Customer));

    const suppliers: Supplier[] = [];
    suppSnap.forEach((d) => suppliers.push(d.data() as Supplier));

    const invoices: Invoice[] = [];
    invSnap.forEach((d) => invoices.push(d.data() as Invoice));

    const purchases: Purchase[] = [];
    purSnap.forEach((d) => purchases.push(d.data() as Purchase));

    const stockMovements: StockMovement[] = [];
    movSnap.forEach((d) => stockMovements.push(d.data() as StockMovement));

    const payments: PaymentRecord[] = [];
    paySnap.forEach((d) => payments.push(d.data() as PaymentRecord));

    const expenses: Expense[] = [];
    expSnap.forEach((d) => expenses.push(d.data() as Expense));

    let categories: string[] | undefined;
    let settings: BusinessSettings | undefined;
    sysSnap.forEach((d) => {
      const data = d.data();
      if (d.id === 'categories' && Array.isArray(data?.list)) {
        categories = data.list;
      }
      if (d.id === 'business_settings' && data?.business_name) {
        const { updated_at_cloud: _ignore, ...cleanSettings } = data as any;
        settings = cleanSettings as BusinessSettings;
      }
    });

    return {
      success: true,
      data: {
        products: products.length > 0 ? products : undefined,
        customers: customers.length > 0 ? customers : undefined,
        suppliers: suppliers.length > 0 ? suppliers : undefined,
        invoices: invoices.length > 0 ? invoices : undefined,
        purchases: purchases.length > 0 ? purchases : undefined,
        stockMovements: stockMovements.length > 0 ? stockMovements : undefined,
        payments: payments.length > 0 ? payments : undefined,
        expenses: expenses.length > 0 ? expenses : undefined,
        categories,
        settings,
      },
      message: `Pulled ${products.length} products, ${invoices.length} invoices, and ${customers.length} customers from Firebase Cloud`,
    };
  } catch (error: any) {
    handleFirestoreError(error, OperationType.LIST, 'store_pull');
    return {
      success: false,
      message: error?.message || 'Failed to pull data from Firebase.',
    };
  }
}

/**
 * Delete a product from Firebase
 */
export async function deleteProductFromCloud(productId: string): Promise<void> {
  try {
    const db = getFirebaseFirestore();
    await deleteDoc(doc(db, 'products', productId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `products/${productId}`);
  }
}
