import React, { useState } from 'react';
import {
  Settings,
  Building,
  Languages,
  Moon,
  Sun,
  CloudCheck,
  CloudAlert,
  Database,
  Download,
  Upload,
  Shield,
  Receipt,
  Boxes,
  Save,
  CheckCircle,
  Trash2,
  AlertTriangle,
  RefreshCw,
  Cloud,
  Flame,
  ShieldCheck,
  Sliders,
  History,
  RotateCcw,
  HardDrive,
  FileArchive,
  GitMerge,
} from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { firebaseConfig } from '../../utils/firebase';

export const SettingsView: React.FC = () => {
  const {
    t,
    settings,
    updateSettings,
    language,
    setLanguage,
    theme,
    setTheme,
    isOnline,
    syncStatus,
    triggerSyncNow,
    exportDatabaseJson,
    importDatabaseJson,
    currentUser,
    users,
    isAdmin,
    hasActionPermission,
    setActiveModule,
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
    sqliteStats,
    snapshots,
    conflicts,
    createManualSnapshot,
    restoreFromSnapshot,
    exportSqliteFile,
    importSqliteFile,
  } = useApp();

  const canManageCloudSync = hasActionPermission('canManageCloudSync');
  const [settingsMsg, setSettingsMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [recoveryMsg, setRecoveryMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [confirmRestoreId, setConfirmRestoreId] = useState<string | null>(null);

  // Local form states
  const [businessName, setBusinessName] = useState(settings.business_name);
  const [ownerName, setOwnerName] = useState(settings.owner_name);
  const [phone, setPhone] = useState(settings.phone);
  const [email, setEmail] = useState(settings.email);
  const [address, setAddress] = useState(settings.address);
  const [currency, setCurrency] = useState(settings.currency);
  const [taxRate, setTaxRate] = useState(settings.tax_rate);
  const [invoicePrefix, setInvoicePrefix] = useState(settings.invoice_prefix);
  const [invoiceFooter, setInvoiceFooter] = useState(settings.invoice_footer);
  const [lowStockThreshold, setLowStockThreshold] = useState(settings.low_stock_threshold);
  const [allowNegativeStock, setAllowNegativeStock] = useState(settings.allow_negative_stock);
  const [autoSync, setAutoSync] = useState(settings.auto_sync);

  // Save changes
  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    updateSettings({
      business_name: businessName,
      owner_name: ownerName,
      phone,
      email,
      address,
      currency,
      tax_rate: taxRate,
      invoice_prefix: invoicePrefix,
      invoice_footer: invoiceFooter,
      low_stock_threshold: lowStockThreshold,
      allow_negative_stock: allowNegativeStock,
      auto_sync: autoSync,
    });
    setSettingsMsg({ text: 'Settings saved to local SQLite database!', type: 'success' });
  };

  // Export JSON Backup
  const handleExportBackup = () => {
    const jsonStr = exportDatabaseJson();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BusinessMind_Backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setRecoveryMsg({ text: 'JSON backup exported successfully.', type: 'success' });
  };

  // Import JSON Backup
  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        if (text) {
          const success = importDatabaseJson(text);
          if (success) {
            setRecoveryMsg({ text: 'Database restored successfully from JSON backup!', type: 'success' });
          } else {
            setRecoveryMsg({ text: 'Invalid backup file. Please provide a valid Business Mind JSON export.', type: 'error' });
          }
        }
      };
      reader.readAsText(file);
    }
    e.target.value = '';
  };

  // Export Binary SQLite .sqlite file
  const handleExportSqlite = () => {
    const bytes = exportSqliteFile();
    if (!bytes) {
      setRecoveryMsg({ text: 'SQLite engine is still initializing. Try again shortly.', type: 'error' });
      return;
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BusinessMind_SQLite_${new Date().toISOString().slice(0, 10)}.sqlite`;
    a.click();
    URL.revokeObjectURL(url);
    setRecoveryMsg({
      text: `Exported native SQLite database (${(bytes.byteLength / 1024).toFixed(1)} KB).`,
      type: 'success',
    });
  };

  // Import Binary SQLite .sqlite file
  const handleImportSqlite = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = async (event) => {
        const buffer = event.target?.result as ArrayBuffer;
        if (buffer) {
          const ok = await importSqliteFile(new Uint8Array(buffer));
          if (ok) {
            setRecoveryMsg({ text: 'SQLite binary database restored cleanly!', type: 'success' });
          } else {
            setRecoveryMsg({ text: 'Invalid SQLite database file.', type: 'error' });
          }
        }
      };
      reader.readAsArrayBuffer(file);
    }
    e.target.value = '';
  };

  const handleCreateManualSnapshot = () => {
    const snap = createManualSnapshot();
    if (snap) {
      setRecoveryMsg({
        text: `Snapshot created (${snap.summary}).`,
        type: 'success',
      });
    } else {
      setRecoveryMsg({ text: 'Could not create SQLite snapshot.', type: 'error' });
    }
  };

  const handleRestoreSnapshot = (snapshotId: string) => {
    const ok = restoreFromSnapshot(snapshotId);
    setConfirmRestoreId(null);
    if (ok) {
      setRecoveryMsg({
        text: 'Restored database from snapshot! A safety pre-restore backup was also saved.',
        type: 'success',
      });
    } else {
      setRecoveryMsg({ text: 'Snapshot restore failed.', type: 'error' });
    }
  };

  // Firebase Cloud Database handlers
  const [isFirebaseSyncing, setIsFirebaseSyncing] = useState(false);
  const [firebaseMsg, setFirebaseMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [settingsCategoryInput, setSettingsCategoryInput] = useState('');

  const handleSyncFirebase = async () => {
    if (!canManageCloudSync) return;
    setIsFirebaseSyncing(true);
    setFirebaseMsg(null);
    const ok = await syncToFirebase();
    setIsFirebaseSyncing(false);
    if (ok) {
      setFirebaseMsg({
        text: `All local products, categories, invoices & dues synced to Firebase Firestore (${firebaseConfig.projectId})!`,
        type: 'success',
      });
    } else {
      setFirebaseMsg({
        text: 'Cloud sync encountered an issue. Local database is fully safe and operational.',
        type: 'error',
      });
    }
  };

  const handlePullFirebase = async () => {
    if (!canManageCloudSync) return;
    setIsFirebaseSyncing(true);
    setFirebaseMsg(null);
    const ok = await syncFromFirebase();
    setIsFirebaseSyncing(false);
    if (ok) {
      setFirebaseMsg({
        text: 'Cloud database pulled and merged successfully into local storage!',
        type: 'success',
      });
    } else {
      setFirebaseMsg({
        text: 'Could not pull from Firebase. Please check internet connection or Firebase rules.',
        type: 'error',
      });
    }
  };

  const handleAddSettingsCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = settingsCategoryInput.trim();
    if (trimmed) {
      addCategory(trimmed);
      setSettingsCategoryInput('');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto pb-24 lg:pb-12 text-slate-100">
      {/* Title */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Settings className="w-6 h-6 text-emerald-400" />
          <span>{t('settings')}</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Configure business profile, language, appearance, offline cloud synchronization, and database backups.
        </p>
      </div>

      <form onSubmit={handleSaveProfile} className="space-y-6">
        {/* Section A: Business Profile */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xs">
          <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
            <Building className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-sm text-white">{t('businessProfile')}</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1">Store / Business Name *</label>
              <input
                type="text"
                required
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">{t('ownerName')}</label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Phone Number *</label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">{t('businessEmail')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block text-slate-300 font-medium mb-1">{t('businessAddress')}</label>
              <input
                type="text"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">{t('currency')}</label>
              <input
                type="text"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-emerald-400 font-mono font-bold focus:border-emerald-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1">Default Tax / VAT (%)</label>
              <input
                type="number"
                min="0"
                value={taxRate}
                onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white font-mono focus:border-emerald-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Section B & C: Language & Theme */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Language Selector */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Languages className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-sm text-white">{t('language')}</h3>
            </div>
            <p className="text-xs text-slate-400">
              Select your interface language (English or বাংলা).
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setLanguage('en')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                  language === 'en'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setLanguage('bn')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                  language === 'bn'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                বাংলা (Bengali)
              </button>
            </div>
          </div>

          {/* Appearance */}
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              {theme === 'dark' ? (
                <Moon className="w-4 h-4 text-emerald-400" />
              ) : (
                <Sun className="w-4 h-4 text-amber-400" />
              )}
              <h3 className="font-bold text-sm text-white">{t('appearance')}</h3>
            </div>
            <p className="text-xs text-slate-400">
              Toggle between high-contrast Dark charcoal and clean Light theme.
            </p>
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => setTheme('dark')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 ${
                  theme === 'dark'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>{t('themeDark')}</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme('light')}
                className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-colors flex items-center justify-center gap-1.5 ${
                  theme === 'light'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                    : 'bg-slate-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>{t('themeLight')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Section D: Cloud Sync & Offline Architecture */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <CloudCheck className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-sm text-white">{t('cloudSync')}</h3>
            </div>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                isOnline ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-300'
              }`}
            >
              {isOnline ? 'Online / Cloud Ready' : 'Offline Mode Active'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400 block text-[11px]">Sync Status</span>
              <span className="font-semibold text-white mt-0.5 block capitalize">
                {syncStatus === 'synced' ? t('syncStatusSynced') : syncStatus === 'syncing' ? 'Syncing...' : t('syncStatusPending')}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400 block text-[11px]">SQLite Sync Queue</span>
              <span className="font-mono font-bold text-emerald-400 mt-0.5 block">
                {sqliteStats.pendingQueueCount} Pending Ops
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400 block text-[11px]">Last Cloud Sync</span>
              <span className="font-mono text-slate-300 mt-0.5 block">
                {settings.last_sync_time ? new Date(settings.last_sync_time).toLocaleTimeString() : 'Pending'}
              </span>
            </div>

            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 flex items-center justify-between">
              <div>
                <span className="text-slate-400 block text-[11px]">{t('autoSync')}</span>
                <span className="font-semibold text-emerald-400 mt-0.5 block">
                  {autoSync ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setAutoSync(!autoSync)}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  autoSync ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
              >
                <div
                  className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-0.5 ${
                    autoSync ? 'right-0.5' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-slate-400 max-w-lg">
              All changes write synchronously to Local SQLite (`sync_queue`) with Record Version + Last Updated tracking. Background sync flushes automatically on reconnect.
            </p>
            <button
              type="button"
              onClick={triggerSyncNow}
              disabled={syncStatus === 'syncing'}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors shadow-sm disabled:opacity-50"
            >
              {syncStatus === 'syncing' ? 'Syncing...' : t('syncNow')}
            </button>
          </div>

          {/* Conflict Resolution Log */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-300 flex items-center gap-1.5">
                <GitMerge className="w-3.5 h-3.5 text-emerald-400" />
                <span>Conflict Resolution Log (Version & Last Updated)</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {conflicts.length} resolved
              </span>
            </div>
            {conflicts.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No version conflicts detected. Local and Cloud record versions are consistent.
              </p>
            ) : (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {conflicts.slice(0, 8).map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px]"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-1.5 py-0.5 rounded bg-slate-800 text-emerald-300 font-mono text-[10px]">
                        {c.collection}
                      </span>
                      <span className="text-slate-300 font-mono truncate max-w-[140px]">{c.docId}</span>
                      <span className="text-slate-500">
                        v{c.localVersion} vs v{c.cloudVersion}
                      </span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        c.winner === 'local'
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-blue-500/15 text-blue-300'
                      }`}
                    >
                      Winner: {c.winner}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section E: Local SQLite Auto-Backup & Data Recovery Center */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-sm text-white">Local SQLite Auto-Backup & Data Recovery</h3>
            </div>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              {sqliteStats.initialized ? `${sqliteStats.engine} · ${(sqliteStats.dbSizeBytes / 1024).toFixed(1)} KB` : 'Initializing SQLite...'}
            </span>
          </div>

          {/* SQLite Storage Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400 block text-[10px]">SQLite Tables Rows</span>
              <span className="font-mono font-bold text-white text-sm mt-0.5 block">
                {Object.values(sqliteStats.tableCounts).reduce((sum, v) => sum + v, 0)}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400 block text-[10px]">Rolling Snapshots</span>
              <span className="font-mono font-bold text-emerald-400 text-sm mt-0.5 block">
                {sqliteStats.snapshotCount} / 10
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400 block text-[10px]">Offline Cached Images</span>
              <span className="font-mono font-bold text-blue-400 text-sm mt-0.5 block">
                {sqliteStats.cachedImageCount}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60">
              <span className="text-slate-400 block text-[10px]">Last Auto Snapshot</span>
              <span className="font-mono text-slate-300 text-[11px] mt-1 block truncate">
                {sqliteStats.lastBackupAt ? new Date(sqliteStats.lastBackupAt).toLocaleTimeString() : 'Scheduled'}
              </span>
            </div>
          </div>

          {recoveryMsg && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                recoveryMsg.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
              }`}
            >
              {recoveryMsg.type === 'success' ? (
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{recoveryMsg.text}</span>
            </div>
          )}

          {/* Export / Import Controls (.sqlite + .json) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/60 space-y-2.5">
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white">Native SQLite Backup (.sqlite)</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Export or restore the complete local SQLite binary file including tables, sync queue & cached images.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportSqlite}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export .sqlite</span>
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-650 text-white transition-colors cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>Import .sqlite</span>
                  <input
                    type="file"
                    accept=".sqlite,.db"
                    onChange={handleImportSqlite}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/60 space-y-2.5">
              <div className="flex items-center gap-2">
                <FileArchive className="w-4 h-4 text-blue-400" />
                <span className="font-bold text-white">Portable JSON Backup (.json)</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                Download or restore human-readable JSON snapshot of all products, invoices, customers & accounts.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportBackup}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-650 text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{t('exportBackup')}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-700 hover:bg-slate-650 text-white transition-colors cursor-pointer">
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>{t('importBackup')}</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportBackup}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Rolling Auto-Snapshots & 1-Click Recovery */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-xs text-white">Auto-Backup Snapshots (1-Click Restore)</span>
              </div>
              <button
                type="button"
                onClick={handleCreateManualSnapshot}
                className="px-3 py-1.5 rounded-lg text-[11px] font-bold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors"
              >
                + Create Snapshot Now
              </button>
            </div>

            {snapshots.length === 0 ? (
              <p className="text-[11px] text-slate-500">
                No snapshots created yet. Auto-backups run automatically every 10 minutes once business data is recorded.
              </p>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                            snap.reason === 'manual'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : snap.reason === 'pre_restore'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-blue-500/20 text-blue-300'
                          }`}
                        >
                          {snap.reason.replace('_', ' ')}
                        </span>
                        <span className="font-mono text-[11px] text-white">
                          {new Date(snap.created_at).toLocaleString()}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono">
                          {(snap.size_bytes / 1024).toFixed(1)} KB
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-0.5 truncate">{snap.summary}</p>
                    </div>

                    {confirmRestoreId === snap.id ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleRestoreSnapshot(snap.id)}
                          className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                        >
                          Confirm Restore
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRestoreId(null)}
                          className="px-2 py-1 rounded-lg text-[11px] bg-slate-800 text-slate-300 hover:bg-slate-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRestoreId(snap.id)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 transition-colors"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Restore</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Section F: Cloud Database (Firebase Firestore) */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Flame className="w-4 h-4 text-amber-400" />
              </div>
              <div>
                <h3 className="font-bold text-sm text-white">Cloud Database (Firebase Firestore)</h3>
                <p className="text-[11px] text-slate-400">
                  Project: <strong className="text-white font-mono">{firebaseConfig.projectId}</strong> (Real-time Cloud Sync)
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1 ${
                  firebaseSyncStatus === 'disconnected' || !isOnline
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                    : firebaseSyncStatus === 'error'
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    !isOnline
                      ? 'bg-amber-400'
                      : firebaseSyncStatus === 'error'
                      ? 'bg-rose-400'
                      : 'bg-emerald-400 animate-pulse'
                  }`}
                />
                {!isOnline
                  ? 'Offline (SQLite Active)'
                  : firebaseSyncStatus === 'syncing'
                  ? 'Syncing Cloud...'
                  : 'Firebase Connected'}
              </span>
            </div>
          </div>

          {/* Switch Button: Manual ↔ Automatic Cloud Database Sync */}
          <div className="p-4 rounded-xl bg-slate-800/90 border border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider">Sync Mode</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${
                    autoFirebaseSync
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {autoFirebaseSync ? '● Automatic Mode' : '○ Manual Mode'}
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                {autoFirebaseSync
                  ? 'Automatic sync is enabled. All sales invoices, product edits, customers and stock changes automatically sync to Firestore.'
                  : 'Manual mode enabled. Changes remain local until you click the "Sync Local Data to Firebase" button below.'}
              </p>
            </div>

            {/* Interactive Switch Button */}
            <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
              <span
                onClick={() => canManageCloudSync && setAutoFirebaseSync(false)}
                className={`text-xs font-semibold select-none transition-colors ${
                  canManageCloudSync ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                } ${
                  !autoFirebaseSync ? 'text-amber-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Manual
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={autoFirebaseSync}
                disabled={!canManageCloudSync}
                onClick={() => canManageCloudSync && setAutoFirebaseSync(!autoFirebaseSync)}
                className={`relative inline-flex h-7 w-13 shrink-0 rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50 disabled:cursor-not-allowed ${
                  autoFirebaseSync
                    ? 'bg-emerald-600 border-emerald-500 cursor-pointer'
                    : 'bg-slate-700 border-slate-600 cursor-pointer'
                }`}
              >
                <span className="sr-only">Toggle Cloud Database Automatic Sync</span>
                <span
                  aria-hidden="true"
                  className={`pointer-events-none inline-block h-5.5 w-5.5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out mt-[1px] ml-[1px] ${
                    autoFirebaseSync ? 'translate-x-6' : 'translate-x-0'
                  }`}
                />
              </button>
              <span
                onClick={() => canManageCloudSync && setAutoFirebaseSync(true)}
                className={`text-xs font-semibold select-none transition-colors ${
                  canManageCloudSync ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed'
                } ${
                  autoFirebaseSync ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Automatic
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 space-y-1">
              <span className="text-slate-400 block text-[11px]">Database Engine</span>
              <span className="font-semibold text-white block">Google Cloud Firestore</span>
              <span className="text-[10px] text-slate-500 block font-mono">{firebaseConfig.projectId}</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 space-y-1">
              <span className="text-slate-400 block text-[11px]">Sync Architecture</span>
              <span className="font-semibold text-emerald-400 block">Bi-directional Offline-First</span>
              <span className="text-[10px] text-slate-500 block">SQLite WASM + Cloud Queue</span>
            </div>
            <div className="p-3 rounded-xl bg-slate-800/80 border border-slate-700/60 space-y-1">
              <span className="text-slate-400 block text-[11px]">Last Cloud Sync</span>
              <span className="font-semibold text-white block truncate">
                {lastFirebaseSync ? new Date(lastFirebaseSync).toLocaleTimeString() : 'Not synced yet'}
              </span>
              <span className="text-[10px] text-slate-500 block">
                {autoFirebaseSync ? 'Auto-synced with cloud' : 'Awaiting manual trigger'}
              </span>
            </div>
          </div>

          {firebaseMsg && (
            <div
              className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
                firebaseMsg.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
              }`}
            >
              {firebaseMsg.type === 'success' ? (
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              )}
              <span>{firebaseMsg.text}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSyncFirebase}
              disabled={isFirebaseSyncing || !canManageCloudSync}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-colors shadow-sm"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFirebaseSyncing ? 'animate-spin' : ''}`} />
              <span>{isFirebaseSyncing ? 'Syncing to Firebase...' : 'Sync Local Data to Firebase'}</span>
            </button>

            <button
              type="button"
              onClick={handlePullFirebase}
              disabled={isFirebaseSyncing || !canManageCloudSync}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-slate-200 transition-colors"
            >
              <Cloud className="w-3.5 h-3.5 text-blue-400" />
              <span>Pull Data from Firebase</span>
            </button>

            {!canManageCloudSync && (
              <span className="text-[11px] text-amber-400">
                Cloud sync controls are restricted to authorized accounts.
              </span>
            )}
          </div>
        </div>

        {/* Section G: Category Management */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-sm text-white">Category Management</h3>
            </div>
            <span className="text-xs text-slate-400">
              {categories.length} Categories Active
            </span>
          </div>

          <form onSubmit={handleAddSettingsCategory} className="flex gap-2">
            <input
              type="text"
              value={settingsCategoryInput}
              onChange={(e) => setSettingsCategoryInput(e.target.value)}
              placeholder="Enter new category name..."
              className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!settingsCategoryInput.trim()}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 transition-colors shrink-0"
            >
              + Add Category
            </button>
          </form>

          <div className="flex flex-wrap gap-2 pt-1">
            {categories.map((cat) => (
              <div
                key={cat}
                className="group pl-3 pr-2 py-1.5 rounded-xl bg-slate-800/90 border border-slate-700/80 flex items-center gap-2 text-xs text-slate-200 hover:border-slate-600 transition-colors"
              >
                <span>{cat}</span>
                {categories.length > 1 && (
                  <button
                    type="button"
                    onClick={() => deleteCategory(cat)}
                    className="p-1 text-slate-500 hover:text-rose-400 rounded transition-colors"
                    title={`Delete ${cat}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Section H: Invoice & Stock Settings */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Receipt className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-sm text-white">Invoice Settings</h3>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Invoice Prefix</label>
                <input
                  type="text"
                  value={invoicePrefix}
                  onChange={(e) => setInvoicePrefix(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1">Receipt Footer Note</label>
                <input
                  type="text"
                  value={invoiceFooter}
                  onChange={(e) => setInvoiceFooter(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white"
                />
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
              <Boxes className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-sm text-white">Stock Configuration</h3>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1">Default Low Stock Alert Threshold</label>
                <input
                  type="number"
                  min="1"
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(parseInt(e.target.value, 10) || 1)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white font-mono"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                <div>
                  <span className="font-semibold text-white block">Allow Negative Stock</span>
                  <span className="text-[10px] text-slate-500">Allow sales even if stock count is zero</span>
                </div>
                <button
                  type="button"
                  onClick={() => setAllowNegativeStock(!allowNegativeStock)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${
                    allowNegativeStock ? 'bg-emerald-500' : 'bg-slate-700'
                  }`}
                >
                  <div
                    className={`w-3.5 h-3.5 rounded-full bg-white transition-transform absolute top-0.5 ${
                      allowNegativeStock ? 'right-0.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section I: Firebase Admin System & Staff Access Control */}
        <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-emerald-400" />
              <h3 className="font-bold text-sm text-white">Firebase Admin System & Staff Access</h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowLoginModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 transition-colors"
              >
                View My Permissions & PIN
              </button>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setActiveModule('admin')}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 transition-colors flex items-center gap-1.5"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Manage Users & Access ({users.length})</span>
                </button>
              )}
            </div>
          </div>

          {currentUser && (
            <div className="p-4 rounded-xl bg-slate-800/80 border border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 font-bold text-sm">
                  {currentUser.name.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-xs">{currentUser.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                      {currentUser.role}
                    </span>
                  </div>
                  <span className="text-slate-400 font-mono text-[11px] block mt-0.5">
                    {currentUser.email}
                  </span>
                </div>
              </div>

              <span className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-emerald-500/20 text-emerald-400 flex items-center gap-1 self-start sm:self-center">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Firebase Auth Verified</span>
              </span>
            </div>
          )}
        </div>

        {/* Save Feedback Banner */}
        {settingsMsg && (
          <div
            className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
              settingsMsg.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
            }`}
          >
            <CheckCircle className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{settingsMsg.text}</span>
          </div>
        )}

        {/* Save Bar */}
        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-lg transition-all"
          >
            <Save className="w-4 h-4" />
            <span>{t('save')} Configuration</span>
          </button>
        </div>
      </form>
    </div>
  );
};
