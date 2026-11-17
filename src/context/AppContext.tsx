import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
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
  SyncLog,
  AppNavigationModule,
  UserAccount,
  FirebaseUserRole,
  UserPermissions,
  ActionPermissions,
  ConflictRecord,
  DatabaseSnapshotMeta,
  SqliteStats,
} from '../types';
import {
  STORAGE_KEYS,
  getLocal,
  setLocal,
  DEFAULT_SETTINGS,
  INITIAL_PRODUCTS,
  INITIAL_CUSTOMERS,
  INITIAL_SUPPLIERS,
  INITIAL_INVOICES,
  INITIAL_EXPENSES,
  INITIAL_SYNC_LOGS,
  INITIAL_CATEGORIES,
  initDatabase,
  hasRealUserData,
  markUserHasRealData,
  hasPendingCloudSync,
  setPendingCloudSync,
  queueCloudDeletion,
  getQueuedCloudDeletions,
  clearQueuedCloudDeletions,
} from '../utils/db';
import {
  getFirebaseAuth,
  testFirestoreConnection,
  resolveAuthorizedUserProfile,
  signInWithFirebaseEmail,
  signInWithFirebaseGoogle,
  bootstrapRootAdminAccount,
  signOutFirebase,
  createStaffUserByAdmin,
  updateStaffUserByAdmin,
  deleteStaffUserByAdmin,
  subscribeToCurrentUserProfile,
  subscribeToAllUsers,
  syncStoreToFirebase,
  fetchStoreFromFirebase,
  getAnyCachedAuthUser,
  resolveRecordConflict,
  flushSyncQueueToFirebase,
} from '../utils/firebase';
import {
  enqueueSyncOperation,
  getPendingSyncQueue,
  removeSyncQueueItems,
  markSyncQueueAttemptError,
  createDatabaseSnapshot,
  listDatabaseSnapshots,
  getSnapshotPayloadById,
  exportSqliteBinary,
  importSqliteBinary,
  getSqliteStats,
  recordConflictsToSqlite,
  getRecentConflictsFromSqlite,
  hasOfflineUnlockPin,
  setOfflineUnlockPin,
  clearOfflineUnlockPin,
  verifyOfflineUnlockPin,
  scheduleSqlitePersist,
} from '../utils/sqlite';
import { warmImageCache } from '../utils/imageCache';
import { translations, Language } from '../utils/i18n';

interface NotificationItem {
  id: string;
  title: string;
  time: string;
  type: 'info' | 'warning' | 'success';
}

interface AppContextType {
  // Navigation & Preferences
  activeModule: AppNavigationModule;
  setActiveModule: (module: AppNavigationModule) => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  theme: 'dark' | 'light';
  setTheme: (theme: 'dark' | 'light') => void;
  t: (key: keyof typeof translations['en']) => string;

  // Global Search & Sync
  globalSearchQuery: string;
  setGlobalSearchQuery: (q: string) => void;
  isOnline: boolean;
  syncStatus: 'synced' | 'pending' | 'syncing';
  triggerSyncNow: () => Promise<void>;
  syncLogs: SyncLog[];

  // Entities
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  invoices: Invoice[];
  purchases: Purchase[];
  stockMovements: StockMovement[];
  payments: PaymentRecord[];
  expenses: Expense[];
  settings: BusinessSettings;
  notifications: NotificationItem[];
  dismissNotification: (id: string) => void;

  // Actions
  addProduct: (product: Omit<Product, 'id' | 'created_at' | 'updated_at'>) => Product;
  updateProduct: (product: Product) => void;
  deleteProduct: (id: string) => void;
  duplicateProduct: (id: string) => void;

  addCustomer: (cust: Omit<Customer, 'id' | 'created_at' | 'total_purchases' | 'total_paid' | 'outstanding_due'>) => Customer;
  updateCustomer: (cust: Customer) => void;
  deleteCustomer: (id: string) => void;
  receiveCustomerPayment: (customerId: string, amount: number, paymentMethod: string, notes?: string, invoiceId?: string) => void;

  addSupplier: (supp: Omit<Supplier, 'id' | 'created_at' | 'total_purchased' | 'total_paid' | 'outstanding_due'>) => Supplier;
  updateSupplier: (supp: Supplier) => void;
  recordSupplierPayment: (supplierId: string, amount: number, paymentMethod: string, notes?: string) => void;

  createInvoice: (invoice: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'>) => Invoice;
  cancelInvoice: (invoiceId: string) => void;

  recordPurchase: (purchase: Omit<Purchase, 'id' | 'purchase_number' | 'created_at'>) => Purchase;
  adjustStock: (productId: string, variantId: string, adjustmentQty: number, type: 'adjustment_in' | 'adjustment_out' | 'damaged', notes?: string) => void;

  addExpense: (exp: Omit<Expense, 'id' | 'created_at'>) => Expense;
  deleteExpense: (id: string) => void;

  updateSettings: (newSettings: Partial<BusinessSettings>) => void;
  exportDatabaseJson: () => string;
  importDatabaseJson: (jsonStr: string) => boolean;

  // Quick Navigation shortcut helper
  openProductInPos?: (product: Product) => void;

  // Firebase Authentication & RBAC
  authLoading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  currentUser: UserAccount | null;
  users: UserAccount[];
  isAdmin: boolean;
  hasModuleAccess: (module: AppNavigationModule) => boolean;
  hasActionPermission: (action: keyof ActionPermissions) => boolean;
  loginWithEmail: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: () => Promise<{ success: boolean; error?: string }>;
  bootstrapRootAdmin: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  createStaffUser: (params: {
    name: string;
    email: string;
    password: string;
    phone?: string;
    role: FirebaseUserRole;
    permissions: UserPermissions;
  }) => Promise<{ success: boolean; error?: string }>;
  updateStaffUser: (
    uid: string,
    updates: Partial<Pick<UserAccount, 'name' | 'phone' | 'role' | 'isActive' | 'permissions'>>
  ) => Promise<{ success: boolean; error?: string }>;
  deleteStaffUser: (uid: string) => Promise<{ success: boolean; error?: string }>;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;

  // Categories Management
  categories: string[];
  addCategory: (name: string) => void;
  deleteCategory: (name: string) => void;

  // Cloud Database Firebase
  firebaseSyncStatus: 'connected' | 'syncing' | 'synced' | 'error' | 'disconnected';
  autoFirebaseSync: boolean;
  setAutoFirebaseSync: (enabled: boolean) => void;
  syncToFirebase: () => Promise<boolean>;
  syncFromFirebase: () => Promise<boolean>;
  lastFirebaseSync: string | null;

  // Offline Security & PIN Unlock
  cachedOfflineUser: UserAccount | null;
  hasOfflinePin: boolean;
  isSessionLockedOffline: boolean;
  authTimedOutOffline: boolean;
  unlockOfflineSession: (pin?: string) => Promise<{ success: boolean; error?: string }>;
  setOfflinePin: (pin: string) => Promise<{ success: boolean; error?: string }>;
  removeOfflinePin: () => void;
  lockSessionOffline: () => void;

  // SQLite Engine, Rolling Snapshots, Conflict Log & Data Recovery
  sqliteStats: SqliteStats;
  snapshots: DatabaseSnapshotMeta[];
  conflicts: ConflictRecord[];
  createManualSnapshot: () => DatabaseSnapshotMeta | null;
  restoreFromSnapshot: (snapshotId: string) => boolean;
  exportSqliteFile: () => Uint8Array | null;
  importSqliteFile: (bytes: Uint8Array) => Promise<boolean>;
  refreshSqliteDiagnostics: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  initDatabase();

  const [activeModule, setActiveModule] = useState<AppNavigationModule>('home');
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'pending' | 'syncing'>('synced');

  const [settings, setSettings] = useState<BusinessSettings>(() =>
    getLocal<BusinessSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS)
  );
  const [products, setProducts] = useState<Product[]>(() =>
    getLocal<Product[]>(STORAGE_KEYS.PRODUCTS, INITIAL_PRODUCTS)
  );
  const [customers, setCustomers] = useState<Customer[]>(() =>
    getLocal<Customer[]>(STORAGE_KEYS.CUSTOMERS, INITIAL_CUSTOMERS)
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>(() =>
    getLocal<Supplier[]>(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS)
  );
  const [invoices, setInvoices] = useState<Invoice[]>(() =>
    getLocal<Invoice[]>(STORAGE_KEYS.INVOICES, INITIAL_INVOICES)
  );
  const [purchases, setPurchases] = useState<Purchase[]>(() =>
    getLocal<Purchase[]>(STORAGE_KEYS.PURCHASES, [])
  );
  const [stockMovements, setStockMovements] = useState<StockMovement[]>(() =>
    getLocal<StockMovement[]>(STORAGE_KEYS.STOCK_MOVEMENTS, [])
  );
  const [payments, setPayments] = useState<PaymentRecord[]>(() =>
    getLocal<PaymentRecord[]>(STORAGE_KEYS.PAYMENTS, [])
  );
  const [expenses, setExpenses] = useState<Expense[]>(() =>
    getLocal<Expense[]>(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES)
  );
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>(() =>
    getLocal<SyncLog[]>(STORAGE_KEYS.SYNC_LOGS, INITIAL_SYNC_LOGS)
  );

  // Offline Cached Session & PIN Security (Synchronous boot check)
  const initialCachedUser = useMemo(() => getAnyCachedAuthUser(), []);
  const initialHasPin = useMemo(
    () => (initialCachedUser ? hasOfflineUnlockPin(initialCachedUser.uid) : hasOfflineUnlockPin()),
    [initialCachedUser]
  );
  const initialIsOffline = typeof navigator !== 'undefined' && !navigator.onLine;

  // Firebase Auth & RBAC state
  // When already offline on boot, NEVER block on Firebase network verification!
  const [authLoading, setAuthLoading] = useState<boolean>(() => !initialIsOffline);
  const [authError, setAuthError] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() =>
    initialIsOffline && initialCachedUser && !initialHasPin ? initialCachedUser : null
  );
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const [cachedOfflineUser, setCachedOfflineUser] = useState<UserAccount | null>(initialCachedUser);
  const [isSessionLockedOffline, setIsSessionLockedOffline] = useState<boolean>(false);
  const [authTimedOutOffline, setAuthTimedOutOffline] = useState<boolean>(false);
  const [hasOfflinePin, setHasOfflinePin] = useState<boolean>(initialHasPin);
  const unlockedViaOfflineRef = useRef<boolean>(
    Boolean(initialIsOffline && initialCachedUser && !initialHasPin)
  );

  // SQLite Engine Diagnostics, Rolling Snapshots & Conflict Log
  const [sqliteStats, setSqliteStats] = useState<SqliteStats>(() => getSqliteStats());
  const [snapshots, setSnapshots] = useState<DatabaseSnapshotMeta[]>(() => listDatabaseSnapshots());
  const [conflicts, setConflicts] = useState<ConflictRecord[]>(() => getRecentConflictsFromSqlite());

  const refreshSqliteDiagnostics = useCallback(() => {
    setSqliteStats(getSqliteStats());
    setSnapshots(listDatabaseSnapshots());
    setConflicts(getRecentConflictsFromSqlite());
  }, []);

  const registerBackgroundSyncTag = useCallback(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready
      .then((reg: any) => {
        if (reg && reg.sync && typeof reg.sync.register === 'function') {
          reg.sync.register('bm-cloud-sync').catch(() => {});
        }
      })
      .catch(() => {});
  }, []);

  const [categories, setCategories] = useState<string[]>(() =>
    getLocal<string[]>(STORAGE_KEYS.CATEGORIES, INITIAL_CATEGORIES)
  );
  const [firebaseSyncStatus, setFirebaseSyncStatus] = useState<
    'connected' | 'syncing' | 'synced' | 'error' | 'disconnected'
  >(() => (typeof navigator !== 'undefined' && !navigator.onLine ? 'disconnected' : 'connected'));
  const [lastFirebaseSync, setLastFirebaseSync] = useState<string | null>(() => {
    return localStorage.getItem('bm_last_fb_sync') || null;
  });
  const [autoFirebaseSync, setAutoFirebaseSyncState] = useState<boolean>(() => {
    const saved = localStorage.getItem('bm_auto_firebase_sync');
    return saved !== null ? saved === 'true' : true;
  });

  const setAutoFirebaseSync = useCallback((enabled: boolean) => {
    setAutoFirebaseSyncState(enabled);
    localStorage.setItem('bm_auto_firebase_sync', String(enabled));
  }, []);

  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: 'notif_1',
      title: 'Business Mind Offline-First SQLite Engine & Cloud RBAC active.',
      time: 'Just now',
      type: 'info',
    },
    {
      id: 'notif_2',
      title: 'Rupchanda Soybean Oil (1L Poly) is running low on stock!',
      time: '1h ago',
      type: 'warning',
    },
  ]);

  const clearAuthError = useCallback(() => setAuthError(null), []);

  // Test Firestore connection on mount only when online
  useEffect(() => {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      testFirestoreConnection();
    }
    refreshSqliteDiagnostics();
  }, [refreshSqliteDiagnostics]);

  // Listen to Firebase Auth + Real-Time Firestore Profile with offline instant unlock & watchdog
  useEffect(() => {
    const auth = getFirebaseAuth();
    let unsubscribeProfile: (() => void) | null = null;
    let authSettled = false;

    // Watchdog: never get stuck on "Verifying Firebase session & access permissions..."
    // when offline, on airplane mode, or on dead Wi-Fi inside WebView.
    const watchdogTimer = setTimeout(() => {
      if (authSettled) return;
      const fallbackUser = getAnyCachedAuthUser();
      if (fallbackUser) {
        const hasPin = hasOfflineUnlockPin(fallbackUser.uid);
        setCachedOfflineUser(fallbackUser);
        setHasOfflinePin(hasPin);
        if (!hasPin) {
          unlockedViaOfflineRef.current = true;
          setCurrentUser((prev) => prev || fallbackUser);
        } else {
          setAuthTimedOutOffline(true);
        }
      } else {
        setAuthTimedOutOffline(true);
      }
      setAuthLoading(false);
    }, 2200);

    const unsubscribeAuth = onAuthStateChanged(auth, async (fbUser) => {
      authSettled = true;
      clearTimeout(watchdogTimer);

      if (unsubscribeProfile) {
        unsubscribeProfile();
        unsubscribeProfile = null;
      }

      if (!fbUser) {
        setCurrentUser((prev) => {
          // Keep unlocked cached session if offline or manually unlocked offline
          if (prev && ((typeof navigator !== 'undefined' && !navigator.onLine) || unlockedViaOfflineRef.current)) {
            return prev;
          }
          return null;
        });
        setCachedOfflineUser(getAnyCachedAuthUser());
        setUsers([]);
        setAuthLoading(false);
        return;
      }

      // If we have cached authorization for this user & no PIN lock, unblock UI immediately!
      const cachedSameUser = getAnyCachedAuthUser();
      if (cachedSameUser && cachedSameUser.uid === fbUser.uid) {
        const hasPin = hasOfflineUnlockPin(cachedSameUser.uid);
        setCachedOfflineUser(cachedSameUser);
        setHasOfflinePin(hasPin);
        if (!hasPin) {
          setCurrentUser((prev) => prev || cachedSameUser);
          setAuthLoading(false);
        }
      }

      try {
        const resolved = await resolveAuthorizedUserProfile(fbUser);
        unlockedViaOfflineRef.current = false;
        setAuthTimedOutOffline(false);
        setCurrentUser(resolved);
        setCachedOfflineUser(resolved);
        setHasOfflinePin(hasOfflineUnlockPin(resolved.uid));
        setAuthError(null);

        // Live listener on current user's profile so permission/role/active changes apply immediately
        unsubscribeProfile = subscribeToCurrentUserProfile(
          fbUser.uid,
          (liveUser) => {
            if (!liveUser) {
              setAuthError('Your account profile was removed by Admin.');
              setCurrentUser(null);
              signOutFirebase().catch(() => {});
              return;
            }
            if (!liveUser.isActive) {
              setAuthError('Your account has been suspended by Admin.');
              setCurrentUser(null);
              signOutFirebase().catch(() => {});
              return;
            }
            setCurrentUser(liveUser);
          },
          (err) => {
            console.warn('Profile subscription warning:', err);
          }
        );
      } catch (err: any) {
        if (
          cachedSameUser &&
          cachedSameUser.uid === fbUser.uid &&
          typeof navigator !== 'undefined' &&
          !navigator.onLine
        ) {
          setCurrentUser(cachedSameUser);
        } else {
          setCurrentUser(null);
          setAuthError(err?.message || 'Access Denied. Only Admin can create accounts.');
        }
      } finally {
        setAuthLoading(false);
      }
    });

    return () => {
      clearTimeout(watchdogTimer);
      if (unsubscribeProfile) unsubscribeProfile();
      unsubscribeAuth();
    };
  }, []);

  // Subscribe to all users list ONLY when signed in as Admin (with offline cache fallback)
  useEffect(() => {
    if (!currentUser || currentUser.role !== 'admin') {
      setUsers([]);
      return;
    }

    const cachedUsers = getLocal<UserAccount[]>(STORAGE_KEYS.CACHED_USERS_LIST, []);
    if (cachedUsers.length > 0) {
      setUsers(cachedUsers);
    }

    const unsubscribeUsers = subscribeToAllUsers(
      (list) => {
        if (list.length > 0 || navigator.onLine) {
          setUsers(list);
        }
      },
      (err) => {
        console.warn('Users subscription warning:', err);
      }
    );

    return () => unsubscribeUsers();
  }, [currentUser?.uid, currentUser?.role]);

  const isAdmin = currentUser?.role === 'admin';

  const hasModuleAccess = useCallback(
    (module: AppNavigationModule): boolean => {
      if (!currentUser) return false;
      if (module === 'admin') return currentUser.role === 'admin';
      if (currentUser.role === 'admin') return true;
      return Boolean(currentUser.permissions?.modules?.[module]);
    },
    [currentUser]
  );

  const hasActionPermission = useCallback(
    (action: keyof ActionPermissions): boolean => {
      if (!currentUser) return false;
      if (currentUser.role === 'admin') return true;
      return Boolean(currentUser.permissions?.actions?.[action]);
    },
    [currentUser]
  );

  // If current user's active module becomes restricted in real time, redirect to first permitted module
  useEffect(() => {
    if (!currentUser) return;
    if (!hasModuleAccess(activeModule)) {
      const candidateOrder: AppNavigationModule[] = [
        'home',
        'invoice',
        'product',
        'sales_history',
        'customers',
        'due',
        'stock',
        'purchases',
        'barcode',
        'expenses',
        'reports',
        'pnl',
        'settings',
      ];
      const firstAllowed = candidateOrder.find((m) => hasModuleAccess(m));
      if (firstAllowed) {
        setActiveModule(firstAllowed);
      }
    }
  }, [currentUser, activeModule, hasModuleAccess]);

  // Online / Offline listener
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setSyncStatus('pending');
    };
    const handleOffline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Sync dark class on root document
  useEffect(() => {
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [settings.theme]);

  // Translation helper
  const t = useCallback(
    (key: keyof typeof translations['en']): string => {
      const lang = settings.language || 'en';
      const dict = translations[lang] || translations.en;
      return dict[key] || translations.en[key] || String(key);
    },
    [settings.language]
  );

  const setLanguage = useCallback((lang: Language) => {
    setSettings((prev) => {
      const updated = { ...prev, language: lang };
      setLocal(STORAGE_KEYS.SETTINGS, updated);
      return updated;
    });
  }, []);

  const setTheme = useCallback((theme: 'dark' | 'light') => {
    setSettings((prev) => {
      const updated = { ...prev, theme };
      setLocal(STORAGE_KEYS.SETTINGS, updated);
      return updated;
    });
  }, []);

  const updateSettings = useCallback(
    (newSettings: Partial<BusinessSettings>) => {
      const now = new Date().toISOString();
      setSettings((prev) => {
        const updated: BusinessSettings = {
          ...prev,
          ...newSettings,
          version: (prev.version || 1) + 1,
          updated_at: now,
        };
        setLocal(STORAGE_KEYS.SETTINGS, updated);
        markUserHasRealData();
        setPendingCloudSync(true);
        enqueueSyncOperation({
          collection_name: 'system',
          doc_id: 'business_settings',
          op_type: 'upsert',
          payload: updated,
          version: updated.version,
          updated_at: now,
        });
        registerBackgroundSyncTag();
        return updated;
      });
      refreshSqliteDiagnostics();
    },
    [refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Products CRUD
  const addProduct = useCallback(
    (data: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Product => {
      const now = new Date().toISOString();
      const newProduct: Product = {
        ...data,
        id: `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      const updated = [newProduct, ...products];
      setProducts(updated);
      setLocal(STORAGE_KEYS.PRODUCTS, updated);
      markUserHasRealData();
      setPendingCloudSync(true);
      enqueueSyncOperation({
        collection_name: 'products',
        doc_id: newProduct.id,
        op_type: 'upsert',
        payload: newProduct,
        version: 1,
        updated_at: now,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setSyncStatus('pending');
      return newProduct;
    },
    [products, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const updateProduct = useCallback(
    (product: Product) => {
      const now = new Date().toISOString();
      const existing = products.find((p) => p.id === product.id);
      const nextVersion = Math.max(product.version || 0, existing?.version || 1) + 1;
      const versioned: Product = {
        ...product,
        updated_at: now,
        version: nextVersion,
      };
      const updated = products.map((p) => (p.id === product.id ? versioned : p));
      setProducts(updated);
      setLocal(STORAGE_KEYS.PRODUCTS, updated);
      markUserHasRealData();
      setPendingCloudSync(true);
      enqueueSyncOperation({
        collection_name: 'products',
        doc_id: versioned.id,
        op_type: 'upsert',
        payload: versioned,
        version: nextVersion,
        updated_at: now,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setSyncStatus('pending');
    },
    [products, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const deleteProduct = useCallback(
    (id: string) => {
      const updated = products.filter((p) => p.id !== id);
      setProducts(updated);
      setLocal(STORAGE_KEYS.PRODUCTS, updated);
      markUserHasRealData();
      queueCloudDeletion('products', id);
      enqueueSyncOperation({
        collection_name: 'products',
        doc_id: id,
        op_type: 'delete',
        updated_at: new Date().toISOString(),
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [products, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const duplicateProduct = useCallback(
    (id: string) => {
      const found = products.find((p) => p.id === id);
      if (!found) return;
      const now = new Date().toISOString();
      const duplicated: Product = {
        ...found,
        id: `prod_${Date.now()}_copy`,
        name: `${found.name} (Copy)`,
        code: `${found.code}-COPY`,
        barcode: `${found.barcode ? found.barcode + '9' : ''}`,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      const updated = [duplicated, ...products];
      setProducts(updated);
      setLocal(STORAGE_KEYS.PRODUCTS, updated);
      markUserHasRealData();
      enqueueSyncOperation({
        collection_name: 'products',
        doc_id: duplicated.id,
        op_type: 'upsert',
        payload: duplicated,
        version: 1,
        updated_at: now,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [products, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Customers CRUD
  const addCustomer = useCallback(
    (data: Omit<Customer, 'id' | 'created_at' | 'total_purchases' | 'total_paid' | 'outstanding_due'>): Customer => {
      const now = new Date().toISOString();
      const newCust: Customer = {
        ...data,
        id: `cust_${Date.now()}`,
        total_purchases: 0,
        total_paid: 0,
        outstanding_due: data.opening_balance || 0,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      const updated = [newCust, ...customers];
      setCustomers(updated);
      setLocal(STORAGE_KEYS.CUSTOMERS, updated);
      markUserHasRealData();
      enqueueSyncOperation({
        collection_name: 'customers',
        doc_id: newCust.id,
        op_type: 'upsert',
        payload: newCust,
        version: 1,
        updated_at: now,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
      return newCust;
    },
    [customers, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const updateCustomer = useCallback(
    (cust: Customer) => {
      const now = new Date().toISOString();
      const existing = customers.find((c) => c.id === cust.id);
      const nextVersion = Math.max(cust.version || 0, existing?.version || 1) + 1;
      const versioned: Customer = {
        ...cust,
        updated_at: now,
        version: nextVersion,
      };
      const updated = customers.map((c) => (c.id === cust.id ? versioned : c));
      setCustomers(updated);
      setLocal(STORAGE_KEYS.CUSTOMERS, updated);
      markUserHasRealData();
      enqueueSyncOperation({
        collection_name: 'customers',
        doc_id: versioned.id,
        op_type: 'upsert',
        payload: versioned,
        version: nextVersion,
        updated_at: now,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [customers, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const deleteCustomer = useCallback(
    (id: string) => {
      const updated = customers.filter((c) => c.id !== id);
      setCustomers(updated);
      setLocal(STORAGE_KEYS.CUSTOMERS, updated);
      markUserHasRealData();
      queueCloudDeletion('customers', id);
      enqueueSyncOperation({
        collection_name: 'customers',
        doc_id: id,
        op_type: 'delete',
        updated_at: new Date().toISOString(),
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [customers, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const receiveCustomerPayment = useCallback(
    (
      customerId: string,
      amount: number,
      paymentMethod: string,
      notes?: string,
      invoiceId?: string
    ) => {
      const cust = customers.find((c) => c.id === customerId);
      if (!cust || amount <= 0) return;

      const now = new Date().toISOString();
      const nextCustVersion = (cust.version || 1) + 1;
      const updatedCust: Customer = {
        ...cust,
        total_paid: cust.total_paid + amount,
        outstanding_due: Math.max(0, cust.outstanding_due - amount),
        updated_at: now,
        version: nextCustVersion,
      };
      const updatedCustomers = customers.map((c) => (c.id === cust.id ? updatedCust : c));
      setCustomers(updatedCustomers);
      setLocal(STORAGE_KEYS.CUSTOMERS, updatedCustomers);
      enqueueSyncOperation({
        collection_name: 'customers',
        doc_id: updatedCust.id,
        op_type: 'upsert',
        payload: updatedCust,
        version: nextCustVersion,
        updated_at: now,
      });

      const newPayment: PaymentRecord = {
        id: `pay_${Date.now()}`,
        business_id: settings.business_id,
        type: 'customer',
        party_id: customerId,
        party_name: cust.name,
        party_phone: cust.phone,
        reference_id: invoiceId,
        amount,
        payment_date: now,
        payment_method: paymentMethod,
        notes,
        updated_at: now,
        version: 1,
      };
      const updatedPayments = [newPayment, ...payments];
      setPayments(updatedPayments);
      setLocal(STORAGE_KEYS.PAYMENTS, updatedPayments);
      enqueueSyncOperation({
        collection_name: 'payments',
        doc_id: newPayment.id,
        op_type: 'upsert',
        payload: newPayment,
        version: 1,
        updated_at: now,
      });

      if (invoiceId) {
        const inv = invoices.find((i) => i.id === invoiceId);
        if (inv) {
          const newPaid = inv.paid_amount + amount;
          const newDue = Math.max(0, inv.grand_total - newPaid);
          const nextInvVersion = (inv.version || 1) + 1;
          const updatedInv: Invoice = {
            ...inv,
            paid_amount: newPaid,
            due_amount: newDue,
            payment_status: (newDue === 0 ? 'paid' : 'partial') as 'paid' | 'partial',
            updated_at: now,
            version: nextInvVersion,
          };
          const updatedInvoices = invoices.map((i) => (i.id === invoiceId ? updatedInv : i));
          setInvoices(updatedInvoices);
          setLocal(STORAGE_KEYS.INVOICES, updatedInvoices);
          enqueueSyncOperation({
            collection_name: 'invoices',
            doc_id: updatedInv.id,
            op_type: 'upsert',
            payload: updatedInv,
            version: nextInvVersion,
            updated_at: now,
          });
        }
      }

      markUserHasRealData();
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [customers, payments, invoices, settings.business_id, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Suppliers CRUD
  const addSupplier = useCallback(
    (data: Omit<Supplier, 'id' | 'created_at' | 'total_purchased' | 'total_paid' | 'outstanding_due'>): Supplier => {
      const now = new Date().toISOString();
      const newSupp: Supplier = {
        ...data,
        id: `supp_${Date.now()}`,
        total_purchased: 0,
        total_paid: 0,
        outstanding_due: 0,
        created_at: now,
        updated_at: now,
        version: 1,
      };
      const updated = [newSupp, ...suppliers];
      setSuppliers(updated);
      setLocal(STORAGE_KEYS.SUPPLIERS, updated);
      markUserHasRealData();
      enqueueSyncOperation({
        collection_name: 'suppliers',
        doc_id: newSupp.id,
        op_type: 'upsert',
        payload: newSupp,
        version: 1,
        updated_at: now,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
      return newSupp;
    },
    [suppliers, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const updateSupplier = useCallback(
    (supp: Supplier) => {
      const now = new Date().toISOString();
      const existing = suppliers.find((s) => s.id === supp.id);
      const nextVersion = Math.max(supp.version || 0, existing?.version || 1) + 1;
      const versioned: Supplier = {
        ...supp,
        updated_at: now,
        version: nextVersion,
      };
      const updated = suppliers.map((s) => (s.id === supp.id ? versioned : s));
      setSuppliers(updated);
      setLocal(STORAGE_KEYS.SUPPLIERS, updated);
      markUserHasRealData();
      enqueueSyncOperation({
        collection_name: 'suppliers',
        doc_id: versioned.id,
        op_type: 'upsert',
        payload: versioned,
        version: nextVersion,
        updated_at: now,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [suppliers, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const recordSupplierPayment = useCallback(
    (supplierId: string, amount: number, paymentMethod: string, notes?: string) => {
      const supp = suppliers.find((s) => s.id === supplierId);
      if (!supp || amount <= 0) return;

      const now = new Date().toISOString();
      const nextSuppVersion = (supp.version || 1) + 1;
      const updatedSupp: Supplier = {
        ...supp,
        total_paid: supp.total_paid + amount,
        outstanding_due: Math.max(0, supp.outstanding_due - amount),
        updated_at: now,
        version: nextSuppVersion,
      };
      const updatedSuppliers = suppliers.map((s) => (s.id === supp.id ? updatedSupp : s));
      setSuppliers(updatedSuppliers);
      setLocal(STORAGE_KEYS.SUPPLIERS, updatedSuppliers);
      enqueueSyncOperation({
        collection_name: 'suppliers',
        doc_id: updatedSupp.id,
        op_type: 'upsert',
        payload: updatedSupp,
        version: nextSuppVersion,
        updated_at: now,
      });

      const newPayment: PaymentRecord = {
        id: `pay_supp_${Date.now()}`,
        business_id: settings.business_id,
        type: 'supplier',
        party_id: supplierId,
        party_name: supp.name,
        party_phone: supp.phone,
        amount,
        payment_date: now,
        payment_method: paymentMethod,
        notes,
        updated_at: now,
        version: 1,
      };
      const updatedPayments = [newPayment, ...payments];
      setPayments(updatedPayments);
      setLocal(STORAGE_KEYS.PAYMENTS, updatedPayments);
      enqueueSyncOperation({
        collection_name: 'payments',
        doc_id: newPayment.id,
        op_type: 'upsert',
        payload: newPayment,
        version: 1,
        updated_at: now,
      });
      markUserHasRealData();
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [suppliers, payments, settings.business_id, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Invoices & POS (100% Offline-First Atomic SQLite + Queue)
  const createInvoice = useCallback(
    (data: Omit<Invoice, 'id' | 'invoice_number' | 'created_at' | 'updated_at'>): Invoice => {
      const now = new Date();
      const nowIso = now.toISOString();
      const yearMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      const count = invoices.length + 1;
      const invoiceNumber = `${settings.invoice_prefix || 'BM-'}${yearMonth}-${String(count).padStart(3, '0')}`;

      const newInvoice: Invoice = {
        ...data,
        id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        invoice_number: invoiceNumber,
        created_at: nowIso,
        updated_at: nowIso,
        version: 1,
      };

      const updatedInvoices = [newInvoice, ...invoices];
      setInvoices(updatedInvoices);
      setLocal(STORAGE_KEYS.INVOICES, updatedInvoices);
      enqueueSyncOperation({
        collection_name: 'invoices',
        doc_id: newInvoice.id,
        op_type: 'upsert',
        payload: newInvoice,
        version: 1,
        updated_at: nowIso,
      });

      const updatedProducts = [...products];
      const touchedProductIds = new Set<string>();
      const newMovements: StockMovement[] = [];

      for (const item of newInvoice.items) {
        const prodIndex = updatedProducts.findIndex((p) => p.id === item.product_id);
        if (prodIndex >= 0) {
          const prod = { ...updatedProducts[prodIndex] };
          const qualities = prod.qualities.map((q) => {
            if (q.id !== item.quality_id) return q;
            const variants = q.variants.map((v) => {
              if (v.id !== item.variant_id) return v;
              const prev = v.stock_quantity;
              const deducted = Math.max(
                settings.allow_negative_stock ? -999999 : 0,
                prev - item.package_quantity
              );
              const mov: StockMovement = {
                id: `mov_${Date.now()}_${v.id}_${Math.random().toString(36).slice(2, 5)}`,
                business_id: settings.business_id,
                product_id: prod.id,
                variant_id: v.id,
                product_name: prod.name,
                variant_info: `${q.name} - ${v.size_weight} ${v.unit}`,
                type: 'sale',
                quantity: item.package_quantity,
                previous_stock: prev,
                new_stock: deducted,
                reference_id: newInvoice.invoice_number,
                timestamp: nowIso,
                updated_at: nowIso,
                version: 1,
              };
              newMovements.push(mov);
              enqueueSyncOperation({
                collection_name: 'stock_movements',
                doc_id: mov.id,
                op_type: 'upsert',
                payload: mov,
                version: 1,
                updated_at: nowIso,
              });
              return { ...v, stock_quantity: deducted };
            });
            return { ...q, variants };
          });
          prod.qualities = qualities;
          prod.updated_at = nowIso;
          prod.version = (prod.version || 1) + 1;
          updatedProducts[prodIndex] = prod;
          touchedProductIds.add(prod.id);
        }
      }

      touchedProductIds.forEach((pid) => {
        const prod = updatedProducts.find((p) => p.id === pid);
        if (prod) {
          enqueueSyncOperation({
            collection_name: 'products',
            doc_id: prod.id,
            op_type: 'upsert',
            payload: prod,
            version: prod.version,
            updated_at: nowIso,
          });
        }
      });

      setProducts(updatedProducts);
      setLocal(STORAGE_KEYS.PRODUCTS, updatedProducts);

      const allMovements = [...newMovements, ...stockMovements];
      setStockMovements(allMovements);
      setLocal(STORAGE_KEYS.STOCK_MOVEMENTS, allMovements);

      if (newInvoice.customer_id) {
        const custIndex = customers.findIndex((c) => c.id === newInvoice.customer_id);
        if (custIndex >= 0) {
          const prevCust = customers[custIndex];
          const cust: Customer = {
            ...prevCust,
            total_purchases: prevCust.total_purchases + newInvoice.grand_total,
            total_paid: prevCust.total_paid + newInvoice.paid_amount,
            outstanding_due: prevCust.outstanding_due + newInvoice.due_amount,
            updated_at: nowIso,
            version: (prevCust.version || 1) + 1,
          };
          const updatedCusts = [...customers];
          updatedCusts[custIndex] = cust;
          setCustomers(updatedCusts);
          setLocal(STORAGE_KEYS.CUSTOMERS, updatedCusts);
          enqueueSyncOperation({
            collection_name: 'customers',
            doc_id: cust.id,
            op_type: 'upsert',
            payload: cust,
            version: cust.version,
            updated_at: nowIso,
          });
        }
      }

      if (newInvoice.paid_amount > 0) {
        const paymentRecord: PaymentRecord = {
          id: `pay_inv_${Date.now()}`,
          business_id: settings.business_id,
          type: 'customer',
          party_id: newInvoice.customer_id,
          party_name: newInvoice.customer_name,
          party_phone: newInvoice.customer_phone,
          reference_id: newInvoice.id,
          reference_number: newInvoice.invoice_number,
          amount: newInvoice.paid_amount,
          payment_date: nowIso,
          payment_method: newInvoice.payment_method,
          notes: `POS invoice payment for ${newInvoice.invoice_number}`,
          updated_at: nowIso,
          version: 1,
        };
        const allPayments = [paymentRecord, ...payments];
        setPayments(allPayments);
        setLocal(STORAGE_KEYS.PAYMENTS, allPayments);
        enqueueSyncOperation({
          collection_name: 'payments',
          doc_id: paymentRecord.id,
          op_type: 'upsert',
          payload: paymentRecord,
          version: 1,
          updated_at: nowIso,
        });
      }

      markUserHasRealData();
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
      return newInvoice;
    },
    [invoices, products, settings, stockMovements, customers, payments, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Cancel Invoice & return stock
  const cancelInvoice = useCallback(
    (invoiceId: string) => {
      const inv = invoices.find((i) => i.id === invoiceId);
      if (!inv || inv.payment_status === 'cancelled') return;

      const now = new Date().toISOString();
      const nextInvVersion = (inv.version || 1) + 1;
      const updatedInv: Invoice = {
        ...inv,
        payment_status: 'cancelled' as const,
        updated_at: now,
        version: nextInvVersion,
      };
      const updatedInvoices = invoices.map((i) => (i.id === invoiceId ? updatedInv : i));
      setInvoices(updatedInvoices);
      setLocal(STORAGE_KEYS.INVOICES, updatedInvoices);
      enqueueSyncOperation({
        collection_name: 'invoices',
        doc_id: updatedInv.id,
        op_type: 'upsert',
        payload: updatedInv,
        version: nextInvVersion,
        updated_at: now,
      });

      const updatedProducts = [...products];
      const touchedProductIds = new Set<string>();
      const newMovements: StockMovement[] = [];

      for (const item of inv.items) {
        const prodIndex = updatedProducts.findIndex((p) => p.id === item.product_id);
        if (prodIndex >= 0) {
          const prod = { ...updatedProducts[prodIndex] };
          prod.qualities = prod.qualities.map((q) => {
            if (q.id !== item.quality_id) return q;
            const variants = q.variants.map((v) => {
              if (v.id !== item.variant_id) return v;
              const prev = v.stock_quantity;
              const restored = prev + item.package_quantity;
              const mov: StockMovement = {
                id: `mov_ret_${Date.now()}_${v.id}_${Math.random().toString(36).slice(2, 5)}`,
                business_id: settings.business_id,
                product_id: prod.id,
                variant_id: v.id,
                product_name: prod.name,
                variant_info: `${q.name} - ${v.size_weight} ${v.unit}`,
                type: 'sale_return',
                quantity: item.package_quantity,
                previous_stock: prev,
                new_stock: restored,
                reference_id: inv.invoice_number,
                timestamp: now,
                updated_at: now,
                version: 1,
              };
              newMovements.push(mov);
              enqueueSyncOperation({
                collection_name: 'stock_movements',
                doc_id: mov.id,
                op_type: 'upsert',
                payload: mov,
                version: 1,
                updated_at: now,
              });
              return { ...v, stock_quantity: restored };
            });
            return { ...q, variants };
          });
          prod.updated_at = now;
          prod.version = (prod.version || 1) + 1;
          updatedProducts[prodIndex] = prod;
          touchedProductIds.add(prod.id);
        }
      }

      touchedProductIds.forEach((pid) => {
        const prod = updatedProducts.find((p) => p.id === pid);
        if (prod) {
          enqueueSyncOperation({
            collection_name: 'products',
            doc_id: prod.id,
            op_type: 'upsert',
            payload: prod,
            version: prod.version,
            updated_at: now,
          });
        }
      });

      setProducts(updatedProducts);
      setLocal(STORAGE_KEYS.PRODUCTS, updatedProducts);

      const allMovements = [...newMovements, ...stockMovements];
      setStockMovements(allMovements);
      setLocal(STORAGE_KEYS.STOCK_MOVEMENTS, allMovements);

      if (inv.customer_id) {
        const custIndex = customers.findIndex((c) => c.id === inv.customer_id);
        if (custIndex >= 0) {
          const prevCust = customers[custIndex];
          const cust: Customer = {
            ...prevCust,
            total_purchases: Math.max(0, prevCust.total_purchases - inv.grand_total),
            total_paid: Math.max(0, prevCust.total_paid - inv.paid_amount),
            outstanding_due: Math.max(0, prevCust.outstanding_due - inv.due_amount),
            updated_at: now,
            version: (prevCust.version || 1) + 1,
          };
          const updatedCusts = [...customers];
          updatedCusts[custIndex] = cust;
          setCustomers(updatedCusts);
          setLocal(STORAGE_KEYS.CUSTOMERS, updatedCusts);
          enqueueSyncOperation({
            collection_name: 'customers',
            doc_id: cust.id,
            op_type: 'upsert',
            payload: cust,
            version: cust.version,
            updated_at: now,
          });
        }
      }

      markUserHasRealData();
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [invoices, products, settings.business_id, stockMovements, customers, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Purchase Recording
  const recordPurchase = useCallback(
    (data: Omit<Purchase, 'id' | 'purchase_number' | 'created_at'>): Purchase => {
      const now = new Date();
      const nowIso = now.toISOString();
      const count = purchases.length + 1;
      const purchaseNumber = `PUR-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-${String(count).padStart(3, '0')}`;

      const newPurchase: Purchase = {
        ...data,
        id: `pur_${Date.now()}`,
        purchase_number: purchaseNumber,
        created_at: nowIso,
        updated_at: nowIso,
        version: 1,
      };

      const updatedPurchases = [newPurchase, ...purchases];
      setPurchases(updatedPurchases);
      setLocal(STORAGE_KEYS.PURCHASES, updatedPurchases);
      enqueueSyncOperation({
        collection_name: 'purchases',
        doc_id: newPurchase.id,
        op_type: 'upsert',
        payload: newPurchase,
        version: 1,
        updated_at: nowIso,
      });

      const updatedProducts = [...products];
      const touchedProductIds = new Set<string>();
      const newMovements: StockMovement[] = [];

      for (const item of newPurchase.items) {
        const prodIndex = updatedProducts.findIndex((p) => p.id === item.product_id);
        if (prodIndex >= 0) {
          const prod = { ...updatedProducts[prodIndex] };
          prod.qualities = prod.qualities.map((q) => {
            if (q.name !== item.quality_name) return q;
            const variants = q.variants.map((v) => {
              if (v.size_weight !== item.size_weight || v.unit !== item.unit) return v;
              const prev = v.stock_quantity;
              const added = prev + item.quantity;
              const mov: StockMovement = {
                id: `mov_pur_${Date.now()}_${v.id}_${Math.random().toString(36).slice(2, 5)}`,
                business_id: settings.business_id,
                product_id: prod.id,
                variant_id: v.id,
                product_name: prod.name,
                variant_info: `${q.name} - ${v.size_weight} ${v.unit}`,
                type: 'purchase',
                quantity: item.quantity,
                previous_stock: prev,
                new_stock: added,
                reference_id: purchaseNumber,
                timestamp: nowIso,
                updated_at: nowIso,
                version: 1,
              };
              newMovements.push(mov);
              enqueueSyncOperation({
                collection_name: 'stock_movements',
                doc_id: mov.id,
                op_type: 'upsert',
                payload: mov,
                version: 1,
                updated_at: nowIso,
              });
              return { ...v, stock_quantity: added };
            });
            return { ...q, variants };
          });
          prod.updated_at = nowIso;
          prod.version = (prod.version || 1) + 1;
          updatedProducts[prodIndex] = prod;
          touchedProductIds.add(prod.id);
        }
      }

      touchedProductIds.forEach((pid) => {
        const prod = updatedProducts.find((p) => p.id === pid);
        if (prod) {
          enqueueSyncOperation({
            collection_name: 'products',
            doc_id: prod.id,
            op_type: 'upsert',
            payload: prod,
            version: prod.version,
            updated_at: nowIso,
          });
        }
      });

      setProducts(updatedProducts);
      setLocal(STORAGE_KEYS.PRODUCTS, updatedProducts);

      const allMovements = [...newMovements, ...stockMovements];
      setStockMovements(allMovements);
      setLocal(STORAGE_KEYS.STOCK_MOVEMENTS, allMovements);

      if (newPurchase.supplier_id) {
        const suppIndex = suppliers.findIndex((s) => s.id === newPurchase.supplier_id);
        if (suppIndex >= 0) {
          const prevSupp = suppliers[suppIndex];
          const supp: Supplier = {
            ...prevSupp,
            total_purchased: prevSupp.total_purchased + newPurchase.grand_total,
            total_paid: prevSupp.total_paid + newPurchase.paid_amount,
            outstanding_due: prevSupp.outstanding_due + newPurchase.supplier_due,
            updated_at: nowIso,
            version: (prevSupp.version || 1) + 1,
          };
          const updatedSupps = [...suppliers];
          updatedSupps[suppIndex] = supp;
          setSuppliers(updatedSupps);
          setLocal(STORAGE_KEYS.SUPPLIERS, updatedSupps);
          enqueueSyncOperation({
            collection_name: 'suppliers',
            doc_id: supp.id,
            op_type: 'upsert',
            payload: supp,
            version: supp.version,
            updated_at: nowIso,
          });
        }
      }

      markUserHasRealData();
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
      return newPurchase;
    },
    [purchases, products, settings.business_id, stockMovements, suppliers, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Manual Stock Adjustment
  const adjustStock = useCallback(
    (
      productId: string,
      variantId: string,
      adjustmentQty: number,
      type: 'adjustment_in' | 'adjustment_out' | 'damaged',
      notes?: string
    ) => {
      const prodIndex = products.findIndex((p) => p.id === productId);
      if (prodIndex < 0) return;

      const nowIso = new Date().toISOString();
      const prevProd = products[prodIndex];
      const nextProdVersion = (prevProd.version || 1) + 1;
      const prod: Product = {
        ...prevProd,
        updated_at: nowIso,
        version: nextProdVersion,
      };
      let prevStock = 0;
      let newStock = 0;
      let variantDescription = '';

      prod.qualities = prod.qualities.map((q) => {
        const variants = q.variants.map((v) => {
          if (v.id !== variantId) return v;
          prevStock = v.stock_quantity;
          variantDescription = `${q.name} - ${v.size_weight} ${v.unit}`;
          if (type === 'adjustment_in') {
            newStock = prevStock + adjustmentQty;
          } else {
            newStock = Math.max(
              settings.allow_negative_stock ? -999999 : 0,
              prevStock - adjustmentQty
            );
          }
          return { ...v, stock_quantity: newStock };
        });
        return { ...q, variants };
      });

      const updatedProducts = [...products];
      updatedProducts[prodIndex] = prod;
      setProducts(updatedProducts);
      setLocal(STORAGE_KEYS.PRODUCTS, updatedProducts);
      enqueueSyncOperation({
        collection_name: 'products',
        doc_id: prod.id,
        op_type: 'upsert',
        payload: prod,
        version: nextProdVersion,
        updated_at: nowIso,
      });

      const movement: StockMovement = {
        id: `mov_adj_${Date.now()}`,
        business_id: settings.business_id,
        product_id: productId,
        variant_id: variantId,
        product_name: prod.name,
        variant_info: variantDescription,
        type,
        quantity: adjustmentQty,
        previous_stock: prevStock,
        new_stock: newStock,
        notes,
        timestamp: nowIso,
        updated_at: nowIso,
        version: 1,
      };

      const allMovements = [movement, ...stockMovements];
      setStockMovements(allMovements);
      setLocal(STORAGE_KEYS.STOCK_MOVEMENTS, allMovements);
      enqueueSyncOperation({
        collection_name: 'stock_movements',
        doc_id: movement.id,
        op_type: 'upsert',
        payload: movement,
        version: 1,
        updated_at: nowIso,
      });
      markUserHasRealData();
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [products, settings.allow_negative_stock, settings.business_id, stockMovements, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Expenses CRUD
  const addExpense = useCallback(
    (data: Omit<Expense, 'id' | 'created_at'>): Expense => {
      const nowIso = new Date().toISOString();
      const newExp: Expense = {
        ...data,
        id: `exp_${Date.now()}`,
        created_at: nowIso,
        updated_at: nowIso,
        version: 1,
      };
      const updated = [newExp, ...expenses];
      setExpenses(updated);
      setLocal(STORAGE_KEYS.EXPENSES, updated);
      markUserHasRealData();
      enqueueSyncOperation({
        collection_name: 'expenses',
        doc_id: newExp.id,
        op_type: 'upsert',
        payload: newExp,
        version: 1,
        updated_at: nowIso,
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
      return newExp;
    },
    [expenses, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const deleteExpense = useCallback(
    (id: string) => {
      const updated = expenses.filter((e) => e.id !== id);
      setExpenses(updated);
      setLocal(STORAGE_KEYS.EXPENSES, updated);
      markUserHasRealData();
      queueCloudDeletion('expenses', id);
      enqueueSyncOperation({
        collection_name: 'expenses',
        doc_id: id,
        op_type: 'delete',
        updated_at: new Date().toISOString(),
      });
      registerBackgroundSyncTag();
      refreshSqliteDiagnostics();
      setPendingCloudSync(true);
      setSyncStatus('pending');
    },
    [expenses, refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // JSON Export / Import
  const exportDatabaseJson = useCallback(() => {
    const backup = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      settings,
      products,
      customers,
      suppliers,
      invoices,
      purchases,
      stockMovements,
      payments,
      expenses,
    };
    return JSON.stringify(backup, null, 2);
  }, [settings, products, customers, suppliers, invoices, purchases, stockMovements, payments, expenses]);

  const importDatabaseJson = useCallback(
    (jsonStr: string): boolean => {
      try {
        const data = JSON.parse(jsonStr);
        if (!data.products || !Array.isArray(data.products)) return false;

        // Safety snapshot before replacing database
        createDatabaseSnapshot('pre_restore');

        if (data.settings) {
          setSettings(data.settings);
          setLocal(STORAGE_KEYS.SETTINGS, data.settings);
        }
        if (data.categories && Array.isArray(data.categories)) {
          setCategories(data.categories);
          setLocal(STORAGE_KEYS.CATEGORIES, data.categories);
        }
        if (data.products) {
          setProducts(data.products);
          setLocal(STORAGE_KEYS.PRODUCTS, data.products);
        }
        if (data.customers) {
          setCustomers(data.customers);
          setLocal(STORAGE_KEYS.CUSTOMERS, data.customers);
        }
        if (data.suppliers) {
          setSuppliers(data.suppliers);
          setLocal(STORAGE_KEYS.SUPPLIERS, data.suppliers);
        }
        if (data.invoices) {
          setInvoices(data.invoices);
          setLocal(STORAGE_KEYS.INVOICES, data.invoices);
        }
        if (data.purchases) {
          setPurchases(data.purchases);
          setLocal(STORAGE_KEYS.PURCHASES, data.purchases);
        }
        if (data.stockMovements) {
          setStockMovements(data.stockMovements);
          setLocal(STORAGE_KEYS.STOCK_MOVEMENTS, data.stockMovements);
        }
        if (data.payments) {
          setPayments(data.payments);
          setLocal(STORAGE_KEYS.PAYMENTS, data.payments);
        }
        if (data.expenses) {
          setExpenses(data.expenses);
          setLocal(STORAGE_KEYS.EXPENSES, data.expenses);
        }
        markUserHasRealData();
        setPendingCloudSync(true);
        scheduleSqlitePersist(true);
        refreshSqliteDiagnostics();
        return true;
      } catch {
        return false;
      }
    },
    [refreshSqliteDiagnostics]
  );

  // Rolling Snapshots & SQLite Binary Export/Import Recovery
  const createManualSnapshot = useCallback((): DatabaseSnapshotMeta | null => {
    const snap = createDatabaseSnapshot('manual');
    refreshSqliteDiagnostics();
    return snap;
  }, [refreshSqliteDiagnostics]);

  const restoreFromSnapshot = useCallback(
    (snapshotId: string): boolean => {
      const payload = getSnapshotPayloadById(snapshotId);
      if (!payload || !Array.isArray(payload.products)) return false;

      // Save safety pre-restore snapshot first
      createDatabaseSnapshot('pre_restore');

      if (payload.settings) {
        setSettings(payload.settings);
        setLocal(STORAGE_KEYS.SETTINGS, payload.settings);
      }
      if (payload.categories && payload.categories.length > 0) {
        setCategories(payload.categories);
        setLocal(STORAGE_KEYS.CATEGORIES, payload.categories);
      }
      setProducts(payload.products);
      setLocal(STORAGE_KEYS.PRODUCTS, payload.products);
      setCustomers(payload.customers || []);
      setLocal(STORAGE_KEYS.CUSTOMERS, payload.customers || []);
      setSuppliers(payload.suppliers || []);
      setLocal(STORAGE_KEYS.SUPPLIERS, payload.suppliers || []);
      setInvoices(payload.invoices || []);
      setLocal(STORAGE_KEYS.INVOICES, payload.invoices || []);
      setPurchases(payload.purchases || []);
      setLocal(STORAGE_KEYS.PURCHASES, payload.purchases || []);
      setStockMovements(payload.stockMovements || []);
      setLocal(STORAGE_KEYS.STOCK_MOVEMENTS, payload.stockMovements || []);
      setPayments(payload.payments || []);
      setLocal(STORAGE_KEYS.PAYMENTS, payload.payments || []);
      setExpenses(payload.expenses || []);
      setLocal(STORAGE_KEYS.EXPENSES, payload.expenses || []);

      markUserHasRealData();
      setPendingCloudSync(true);
      scheduleSqlitePersist(true);
      refreshSqliteDiagnostics();
      return true;
    },
    [refreshSqliteDiagnostics]
  );

  const exportSqliteFile = useCallback((): Uint8Array | null => {
    return exportSqliteBinary();
  }, []);

  const importSqliteFile = useCallback(
    async (bytes: Uint8Array): Promise<boolean> => {
      const ok = await importSqliteBinary(bytes);
      if (!ok) return false;

      setSettings(getLocal<BusinessSettings>(STORAGE_KEYS.SETTINGS, DEFAULT_SETTINGS));
      setCategories(getLocal<string[]>(STORAGE_KEYS.CATEGORIES, INITIAL_CATEGORIES));
      setProducts(getLocal<Product[]>(STORAGE_KEYS.PRODUCTS, []));
      setCustomers(getLocal<Customer[]>(STORAGE_KEYS.CUSTOMERS, []));
      setSuppliers(getLocal<Supplier[]>(STORAGE_KEYS.SUPPLIERS, []));
      setInvoices(getLocal<Invoice[]>(STORAGE_KEYS.INVOICES, []));
      setPurchases(getLocal<Purchase[]>(STORAGE_KEYS.PURCHASES, []));
      setStockMovements(getLocal<StockMovement[]>(STORAGE_KEYS.STOCK_MOVEMENTS, []));
      setPayments(getLocal<PaymentRecord[]>(STORAGE_KEYS.PAYMENTS, []));
      setExpenses(getLocal<Expense[]>(STORAGE_KEYS.EXPENSES, []));
      markUserHasRealData();
      setPendingCloudSync(true);
      refreshSqliteDiagnostics();
      return true;
    },
    [refreshSqliteDiagnostics]
  );

  // Firebase Auth Actions & Offline Session/PIN Unlock
  const loginWithEmail = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    try {
      const profile = await signInWithFirebaseEmail(email, password);
      setCurrentUser(profile);
      setCachedOfflineUser(profile);
      setHasOfflinePin(hasOfflineUnlockPin(profile.uid));
      setIsSessionLockedOffline(false);
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Sign in failed.';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    setAuthError(null);
    try {
      const profile = await signInWithFirebaseGoogle();
      setCurrentUser(profile);
      setCachedOfflineUser(profile);
      setHasOfflinePin(hasOfflineUnlockPin(profile.uid));
      setIsSessionLockedOffline(false);
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Google sign in failed.';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  }, []);

  const bootstrapRootAdmin = useCallback(async (email: string, password: string, name: string) => {
    setAuthError(null);
    try {
      const profile = await bootstrapRootAdminAccount(email, password, name);
      setCurrentUser(profile);
      setCachedOfflineUser(profile);
      setHasOfflinePin(hasOfflineUnlockPin(profile.uid));
      setIsSessionLockedOffline(false);
      return { success: true };
    } catch (err: any) {
      const msg = err?.message || 'Root Admin setup failed.';
      setAuthError(msg);
      return { success: false, error: msg };
    }
  }, []);

  const unlockOfflineSession = useCallback(
    async (pin?: string): Promise<{ success: boolean; error?: string }> => {
      const cached = cachedOfflineUser || getAnyCachedAuthUser();
      if (!cached) {
        return {
          success: false,
          error: 'No cached session found. Connect to the internet once to sign in first.',
        };
      }
      if (hasOfflineUnlockPin(cached.uid)) {
        if (!pin || !pin.trim()) {
          return { success: false, error: 'Please enter your Offline Unlock PIN.' };
        }
        const ok = await verifyOfflineUnlockPin(cached.uid, pin);
        if (!ok) {
          return { success: false, error: 'Incorrect Offline PIN. Please try again.' };
        }
      }
      unlockedViaOfflineRef.current = true;
      setAuthTimedOutOffline(false);
      setCurrentUser(cached);
      setCachedOfflineUser(cached);
      setIsSessionLockedOffline(false);
      setAuthError(null);
      return { success: true };
    },
    [cachedOfflineUser]
  );

  const setOfflinePin = useCallback(
    async (pin: string): Promise<{ success: boolean; error?: string }> => {
      const user = currentUser || cachedOfflineUser;
      if (!user) {
        return { success: false, error: 'No active user account to bind PIN.' };
      }
      const clean = pin.trim();
      if (!/^\d{4,6}$/.test(clean)) {
        return { success: false, error: 'PIN must be 4 to 6 numeric digits.' };
      }
      await setOfflineUnlockPin(user.uid, clean);
      setHasOfflinePin(true);
      return { success: true };
    },
    [currentUser, cachedOfflineUser]
  );

  const removeOfflinePin = useCallback(() => {
    clearOfflineUnlockPin();
    setHasOfflinePin(false);
  }, []);

  const lockSessionOffline = useCallback(() => {
    setShowLoginModal(false);
    setIsSessionLockedOffline(true);
  }, []);

  const logout = useCallback(async () => {
    unlockedViaOfflineRef.current = false;
    setAuthTimedOutOffline(false);
    await signOutFirebase();
    setCurrentUser(null);
    setCachedOfflineUser(null);
    setIsSessionLockedOffline(false);
    setUsers([]);
    setShowLoginModal(false);
    setActiveModule('home');
  }, []);

  const createStaffUser = useCallback(
    async (params: {
      name: string;
      email: string;
      password: string;
      phone?: string;
      role: FirebaseUserRole;
      permissions: UserPermissions;
    }) => {
      if (!currentUser || currentUser.role !== 'admin') {
        return { success: false, error: 'Unauthorized: Only Admin can create accounts.' };
      }
      try {
        await createStaffUserByAdmin({
          ...params,
          adminUid: currentUser.uid,
        });
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to create account.' };
      }
    },
    [currentUser]
  );

  const updateStaffUser = useCallback(
    async (
      uid: string,
      updates: Partial<Pick<UserAccount, 'name' | 'phone' | 'role' | 'isActive' | 'permissions'>>
    ) => {
      if (!currentUser || currentUser.role !== 'admin') {
        return { success: false, error: 'Unauthorized: Only Admin can update access controls.' };
      }
      try {
        await updateStaffUserByAdmin(uid, updates);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to update account.' };
      }
    },
    [currentUser]
  );

  const deleteStaffUser = useCallback(
    async (uid: string) => {
      if (!currentUser || currentUser.role !== 'admin') {
        return { success: false, error: 'Unauthorized: Only Admin can delete accounts.' };
      }
      if (uid === currentUser.uid) {
        return { success: false, error: 'You cannot delete your own active Admin account.' };
      }
      try {
        await deleteStaffUserByAdmin(uid);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err?.message || 'Failed to delete user.' };
      }
    },
    [currentUser]
  );

  const addCategory = useCallback(
    (newCat: string) => {
      const trimmed = newCat.trim();
      if (!trimmed) return;
      const now = new Date().toISOString();
      setCategories((prev) => {
        if (prev.includes(trimmed)) return prev;
        const updated = [...prev, trimmed];
        setLocal(STORAGE_KEYS.CATEGORIES, updated);
        markUserHasRealData();
        setPendingCloudSync(true);
        enqueueSyncOperation({
          collection_name: 'system',
          doc_id: 'categories',
          op_type: 'upsert',
          payload: { list: updated },
          version: updated.length,
          updated_at: now,
        });
        registerBackgroundSyncTag();
        return updated;
      });
      refreshSqliteDiagnostics();
    },
    [refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  const deleteCategory = useCallback(
    (catToDelete: string) => {
      const now = new Date().toISOString();
      setCategories((prev) => {
        const updated = prev.filter((c) => c !== catToDelete);
        setLocal(STORAGE_KEYS.CATEGORIES, updated);
        markUserHasRealData();
        setPendingCloudSync(true);
        enqueueSyncOperation({
          collection_name: 'system',
          doc_id: 'categories',
          op_type: 'upsert',
          payload: { list: updated },
          version: updated.length,
          updated_at: now,
        });
        registerBackgroundSyncTag();
        return updated;
      });
      refreshSqliteDiagnostics();
    },
    [refreshSqliteDiagnostics, registerBackgroundSyncTag]
  );

  // Always keep a ref to latest store state so async auto-sync & reconnect handlers never push stale state
  const latestStoreRef = useRef({
    products,
    customers,
    suppliers,
    invoices,
    purchases,
    stockMovements,
    payments,
    expenses,
    categories,
    settings,
  });
  useEffect(() => {
    latestStoreRef.current = {
      products,
      customers,
      suppliers,
      invoices,
      purchases,
      stockMovements,
      payments,
      expenses,
      categories,
      settings,
    };
  }, [products, customers, suppliers, invoices, purchases, stockMovements, payments, expenses, categories, settings]);

  // Flush persistent SQLite sync_queue cleanly to Firestore
  const flushPendingQueue = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return false;
    }
    const queue = getPendingSyncQueue();
    if (queue.length === 0) return true;

    const res = await flushSyncQueueToFirebase(queue);
    if (res.success && res.processedIds.length > 0) {
      removeSyncQueueItems(res.processedIds);
      refreshSqliteDiagnostics();
      return true;
    }
    if (!res.success && res.error) {
      markSyncQueueAttemptError(
        queue.map((q) => q.op_id),
        res.error
      );
      refreshSqliteDiagnostics();
    }
    return false;
  }, [refreshSqliteDiagnostics]);

  const syncToFirebase = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFirebaseSyncStatus('disconnected');
      setPendingCloudSync(true);
      return false;
    }
    setFirebaseSyncStatus('syncing');
    setSyncStatus('syncing');
    try {
      await flushPendingQueue();
      const snapshot = latestStoreRef.current;
      const res = await syncStoreToFirebase({
        ...snapshot,
        deletedRefs: getQueuedCloudDeletions(),
      });
      if (res.success) {
        const remainingQueue = getPendingSyncQueue();
        if (remainingQueue.length > 0) {
          removeSyncQueueItems(remainingQueue.map((q) => q.op_id));
        }
        setPendingCloudSync(false);
        clearQueuedCloudDeletions();
        setSyncStatus('synced');
        setFirebaseSyncStatus('synced');
        setLastFirebaseSync(res.syncedAt);
        localStorage.setItem('bm_last_fb_sync', res.syncedAt);
        refreshSqliteDiagnostics();
        return true;
      } else {
        setFirebaseSyncStatus('error');
        setSyncStatus('pending');
        return false;
      }
    } catch {
      setFirebaseSyncStatus('error');
      setSyncStatus('pending');
      return false;
    }
  }, [flushPendingQueue, refreshSqliteDiagnostics]);

  const syncFromFirebase = useCallback(async (): Promise<boolean> => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFirebaseSyncStatus('disconnected');
      return false;
    }
    setFirebaseSyncStatus('syncing');
    try {
      const res = await fetchStoreFromFirebase();
      if (res.success && res.data) {
        const cloud = res.data;
        const localAlreadyHasUserEdits = hasRealUserData();
        const deletedQueue = getQueuedCloudDeletions();
        const detectedConflicts: ConflictRecord[] = [];

        const mergeList = <
          T extends {
            id: string;
            version?: number;
            updated_at?: string;
            created_at?: string;
            date?: string;
            timestamp?: string;
          }
        >(
          localItems: T[],
          cloudItems: T[] | undefined,
          collectionName: string
        ): T[] | null => {
          if (!cloudItems || cloudItems.length === 0) return null;
          const deletedSet = new Set(
            deletedQueue.filter((d) => d.collection === collectionName).map((d) => d.id)
          );
          const filteredCloud = cloudItems.filter((item) => !deletedSet.has(item.id));
          if (!localAlreadyHasUserEdits) {
            return filteredCloud;
          }
          const byId = new Map<string, T>();
          filteredCloud.forEach((item) => byId.set(item.id, item));
          localItems.forEach((localItem) => {
            const existing = byId.get(localItem.id);
            if (!existing) {
              byId.set(localItem.id, localItem);
            } else {
              const { chosen, conflict } = resolveRecordConflict(
                collectionName,
                localItem,
                existing
              );
              byId.set(localItem.id, chosen);
              if (conflict) {
                detectedConflicts.push(conflict);
              }
            }
          });
          return Array.from(byId.values());
        };

        const snap = latestStoreRef.current;
        let restoredAny = false;

        const nextProducts = mergeList(snap.products, cloud.products, 'products');
        if (nextProducts) {
          setProducts(nextProducts);
          setLocal(STORAGE_KEYS.PRODUCTS, nextProducts);
          restoredAny = true;
        }

        const nextCustomers = mergeList(snap.customers, cloud.customers, 'customers');
        if (nextCustomers) {
          setCustomers(nextCustomers);
          setLocal(STORAGE_KEYS.CUSTOMERS, nextCustomers);
          restoredAny = true;
        }

        const nextSuppliers = mergeList(snap.suppliers, cloud.suppliers, 'suppliers');
        if (nextSuppliers) {
          setSuppliers(nextSuppliers);
          setLocal(STORAGE_KEYS.SUPPLIERS, nextSuppliers);
          restoredAny = true;
        }

        const nextInvoices = mergeList(snap.invoices, cloud.invoices, 'invoices');
        if (nextInvoices) {
          setInvoices(nextInvoices);
          setLocal(STORAGE_KEYS.INVOICES, nextInvoices);
          restoredAny = true;
        }

        const nextPurchases = mergeList(snap.purchases, cloud.purchases, 'purchases');
        if (nextPurchases) {
          setPurchases(nextPurchases);
          setLocal(STORAGE_KEYS.PURCHASES, nextPurchases);
          restoredAny = true;
        }

        const nextMovements = mergeList(snap.stockMovements, cloud.stockMovements, 'stock_movements');
        if (nextMovements) {
          setStockMovements(nextMovements);
          setLocal(STORAGE_KEYS.STOCK_MOVEMENTS, nextMovements);
          restoredAny = true;
        }

        const nextPayments = mergeList(snap.payments, cloud.payments, 'payments');
        if (nextPayments) {
          setPayments(nextPayments);
          setLocal(STORAGE_KEYS.PAYMENTS, nextPayments);
          restoredAny = true;
        }

        const nextExpenses = mergeList(snap.expenses, cloud.expenses, 'expenses');
        if (nextExpenses) {
          setExpenses(nextExpenses);
          setLocal(STORAGE_KEYS.EXPENSES, nextExpenses);
          restoredAny = true;
        }

        if (cloud.categories && cloud.categories.length > 0) {
          const nextCategories = localAlreadyHasUserEdits
            ? Array.from(new Set([...snap.categories, ...cloud.categories]))
            : cloud.categories;
          setCategories(nextCategories);
          setLocal(STORAGE_KEYS.CATEGORIES, nextCategories);
          restoredAny = true;
        }

        if (cloud.settings && !localAlreadyHasUserEdits) {
          setSettings(cloud.settings);
          setLocal(STORAGE_KEYS.SETTINGS, cloud.settings);
          restoredAny = true;
        }

        if (detectedConflicts.length > 0) {
          recordConflictsToSqlite(detectedConflicts);
        }

        if (restoredAny) {
          markUserHasRealData();
        }

        setFirebaseSyncStatus('synced');
        const now = new Date().toISOString();
        setLastFirebaseSync(now);
        localStorage.setItem('bm_last_fb_sync', now);
        refreshSqliteDiagnostics();
        return true;
      } else {
        setFirebaseSyncStatus('error');
        return false;
      }
    } catch {
      setFirebaseSyncStatus('error');
      return false;
    }
  }, [refreshSqliteDiagnostics]);

  // Real Bi-Directional Manual Sync (replaces placeholder delay)
  const triggerSyncNow = useCallback(async () => {
    const nowIso = new Date().toISOString();
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      const pendingCount = getPendingSyncQueue().length;
      const offlineLog: SyncLog = {
        id: `sync_${Date.now()}`,
        timestamp: nowIso,
        action: 'Offline Queue Check',
        status: 'pending',
        details: `Offline mode active. ${pendingCount} queued change(s) safely saved in SQLite for background sync.`,
      };
      const updatedLogs = [offlineLog, ...syncLogs].slice(0, 30);
      setSyncLogs(updatedLogs);
      setLocal(STORAGE_KEYS.SYNC_LOGS, updatedLogs);
      setSyncStatus('pending');
      return;
    }

    setSyncStatus('syncing');
    const pushed = await syncToFirebase();
    const pulled = await syncFromFirebase();

    const snap = latestStoreRef.current;
    const newLog: SyncLog = {
      id: `sync_${Date.now()}`,
      timestamp: nowIso,
      action: 'Firebase Push & Pull Sync',
      status: pushed && pulled ? 'synced' : 'failed',
      details:
        pushed && pulled
          ? `Synced ${snap.products.length} products, ${snap.invoices.length} invoices & ${snap.customers.length} customers with Firestore.`
          : 'Cloud sync partially failed. All changes remain safe in local SQLite.',
    };
    const updatedLogs = [newLog, ...syncLogs].slice(0, 30);
    setSyncLogs(updatedLogs);
    setLocal(STORAGE_KEYS.SYNC_LOGS, updatedLogs);
    if (pushed && pulled) {
      setSettings((prev) => {
        const updated = { ...prev, last_sync_time: nowIso };
        setLocal(STORAGE_KEYS.SETTINGS, updated);
        return updated;
      });
      setSyncStatus('synced');
    } else {
      setSyncStatus('pending');
    }
  }, [syncLogs, syncToFirebase, syncFromFirebase]);

  // Auto-restore cloud data on login / post-update boot, and flush offline SQLite queue first if pending
  const restoredForUidRef = useRef<string | null>(null);
  useEffect(() => {
    if (!currentUser) {
      restoredForUidRef.current = null;
      return;
    }
    if (!navigator.onLine) {
      setFirebaseSyncStatus('disconnected');
      return;
    }
    if (restoredForUidRef.current === currentUser.uid) return;
    restoredForUidRef.current = currentUser.uid;

    let cancelled = false;
    (async () => {
      if (hasPendingCloudSync() || getPendingSyncQueue().length > 0) {
        await syncToFirebase();
      }
      if (!cancelled) {
        await syncFromFirebase();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentUser, syncToFirebase, syncFromFirebase]);

  // Flush pending offline edits automatically when network comes back online or tab becomes visible
  useEffect(() => {
    const runAutoFlush = () => {
      if (!navigator.onLine || !currentUser || !autoFirebaseSync) return;
      if (hasPendingCloudSync() || getPendingSyncQueue().length > 0) {
        syncToFirebase();
      }
    };

    if (isOnline && currentUser) {
      if ((hasPendingCloudSync() || getPendingSyncQueue().length > 0) && autoFirebaseSync) {
        syncToFirebase();
      } else if (restoredForUidRef.current !== currentUser.uid) {
        restoredForUidRef.current = currentUser.uid;
        syncFromFirebase();
      } else {
        setFirebaseSyncStatus('connected');
      }
    } else if (!isOnline) {
      setFirebaseSyncStatus('disconnected');
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        runAutoFlush();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [isOnline, currentUser, autoFirebaseSync, syncToFirebase, syncFromFirebase]);

  // Automatic Firebase Sync effect: Debounced SQLite queue flush + cloud backup while online
  const hasMountedFirebaseRef = useRef(false);
  useEffect(() => {
    if (!hasMountedFirebaseRef.current) {
      hasMountedFirebaseRef.current = true;
      return;
    }
    if (!currentUser || !autoFirebaseSync || !navigator.onLine) return;
    if (!hasPendingCloudSync() && getPendingSyncQueue().length === 0) return;

    const timer = setTimeout(() => {
      syncToFirebase();
    }, 2000);
    return () => clearTimeout(timer);
  }, [
    currentUser,
    autoFirebaseSync,
    products,
    customers,
    suppliers,
    invoices,
    purchases,
    stockMovements,
    payments,
    expenses,
    categories,
    settings,
    syncToFirebase,
  ]);

  // Rolling Auto-Backup scheduler inside SQLite (startup check + every 10 minutes)
  useEffect(() => {
    const checkAndCreateAutoSnapshot = () => {
      if (!hasRealUserData()) return;
      const existing = listDatabaseSnapshots();
      const latestTs = existing[0] ? Date.parse(existing[0].created_at) || 0 : 0;
      const ageMs = Date.now() - latestTs;
      if (existing.length === 0 || ageMs >= 10 * 60 * 1000) {
        createDatabaseSnapshot('auto');
        refreshSqliteDiagnostics();
      }
    };

    const bootTimer = setTimeout(checkAndCreateAutoSnapshot, 4000);
    const interval = setInterval(checkAndCreateAutoSnapshot, 10 * 60 * 1000);

    return () => {
      clearTimeout(bootTimer);
      clearInterval(interval);
    };
  }, [refreshSqliteDiagnostics]);

  // Pre-warm offline SQLite + CacheStorage product image cache whenever online
  useEffect(() => {
    if (!isOnline || products.length === 0) return;
    const urls = products.map((p) => p.image_url);
    warmImageCache(urls);
    const timer = setTimeout(() => {
      refreshSqliteDiagnostics();
    }, 2500);
    return () => clearTimeout(timer);
  }, [isOnline, products, refreshSqliteDiagnostics]);

  const value = useMemo(
    () => ({
      activeModule,
      setActiveModule,
      language: settings.language,
      setLanguage,
      theme: settings.theme,
      setTheme,
      t,
      globalSearchQuery,
      setGlobalSearchQuery,
      isOnline,
      syncStatus,
      triggerSyncNow,
      syncLogs,
      products,
      customers,
      suppliers,
      invoices,
      purchases,
      stockMovements,
      payments,
      expenses,
      settings,
      notifications,
      dismissNotification,
      addProduct,
      updateProduct,
      deleteProduct,
      duplicateProduct,
      addCustomer,
      updateCustomer,
      deleteCustomer,
      receiveCustomerPayment,
      addSupplier,
      updateSupplier,
      recordSupplierPayment,
      createInvoice,
      cancelInvoice,
      recordPurchase,
      adjustStock,
      addExpense,
      deleteExpense,
      updateSettings,
      exportDatabaseJson,
      importDatabaseJson,
      authLoading,
      authError,
      clearAuthError,
      currentUser,
      users,
      isAdmin,
      hasModuleAccess,
      hasActionPermission,
      loginWithEmail,
      loginWithGoogle,
      bootstrapRootAdmin,
      logout,
      createStaffUser,
      updateStaffUser,
      deleteStaffUser,
      showLoginModal,
      setShowLoginModal,
      categories,
      addCategory,
      deleteCategory,
      firebaseSyncStatus,
      autoFirebaseSync,
      setAutoFirebaseSync,
      syncToFirebase,
      syncFromFirebase,
      lastFirebaseSync,
      cachedOfflineUser,
      hasOfflinePin,
      isSessionLockedOffline,
      authTimedOutOffline,
      unlockOfflineSession,
      setOfflinePin,
      removeOfflinePin,
      lockSessionOffline,
      sqliteStats,
      snapshots,
      conflicts,
      createManualSnapshot,
      restoreFromSnapshot,
      exportSqliteFile,
      importSqliteFile,
      refreshSqliteDiagnostics,
    }),
    [
      activeModule,
      settings,
      setLanguage,
      setTheme,
      t,
      globalSearchQuery,
      isOnline,
      syncStatus,
      triggerSyncNow,
      syncLogs,
      products,
      customers,
      suppliers,
      invoices,
      purchases,
      stockMovements,
      payments,
      expenses,
      notifications,
      dismissNotification,
      addProduct,
      updateProduct,
      deleteProduct,
      duplicateProduct,
      addCustomer,
      updateCustomer,
      deleteCustomer,
      receiveCustomerPayment,
      addSupplier,
      updateSupplier,
      recordSupplierPayment,
      createInvoice,
      cancelInvoice,
      recordPurchase,
      adjustStock,
      addExpense,
      deleteExpense,
      updateSettings,
      exportDatabaseJson,
      importDatabaseJson,
      authLoading,
      authError,
      clearAuthError,
      currentUser,
      users,
      isAdmin,
      hasModuleAccess,
      hasActionPermission,
      loginWithEmail,
      loginWithGoogle,
      bootstrapRootAdmin,
      logout,
      createStaffUser,
      updateStaffUser,
      deleteStaffUser,
      showLoginModal,
      setShowLoginModal,
      categories,
      addCategory,
      deleteCategory,
      firebaseSyncStatus,
      autoFirebaseSync,
      setAutoFirebaseSync,
      syncToFirebase,
      syncFromFirebase,
      lastFirebaseSync,
      cachedOfflineUser,
      hasOfflinePin,
      isSessionLockedOffline,
      authTimedOutOffline,
      unlockOfflineSession,
      setOfflinePin,
      removeOfflinePin,
      lockSessionOffline,
      sqliteStats,
      snapshots,
      conflicts,
      createManualSnapshot,
      restoreFromSnapshot,
      exportSqliteFile,
      importSqliteFile,
      refreshSqliteDiagnostics,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
