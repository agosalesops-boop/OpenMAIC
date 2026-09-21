'use client';

import { useEffect, useState, useCallback } from 'react';
import { toast } from 'sonner';
import { Plus, Copy, Check, ShieldCheck, GraduationCap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useI18n } from '@/lib/hooks/use-i18n';
import type { AccountRole } from '@/lib/persistence/accounts';

interface AccountRow {
  id: string;
  name: string;
  role: AccountRole;
  createdAt: string;
  revokedAt: string | null;
}

export function AccountsSettings() {
  const { t, locale } = useI18n();
  const [accounts, setAccounts] = useState<AccountRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<AccountRole>('learner');
  const [creating, setCreating] = useState(false);

  const [generatedCode, setGeneratedCode] = useState<{ name: string; code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [pendingRevoke, setPendingRevoke] = useState<AccountRow | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadAccounts = useCallback(() => {
    setLoadError(false);
    fetch('/api/accounts')
      .then((res) => {
        if (!res.ok) throw new Error('failed');
        return res.json();
      })
      .then((data: { accounts: AccountRow[] }) => setAccounts(data.accounts))
      .catch(() => {
        setLoadError(true);
        setAccounts([]);
      });
  }, []);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) {
      toast.error(t('settings.accounts.nameRequired'));
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, role: newRole }),
      });
      if (!res.ok) throw new Error('failed');
      const data: { account: AccountRow; code: string } = await res.json();
      setAccounts((prev) => (prev ? [data.account, ...prev] : [data.account]));
      setGeneratedCode({ name: data.account.name, code: data.code });
      setNewName('');
    } catch {
      toast.error(t('settings.accounts.createError'));
    } finally {
      setCreating(false);
    }
  }

  async function handleCopyGeneratedCode() {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — the code is still visible to copy by hand.
    }
  }

  async function handleConfirmRevoke() {
    if (!pendingRevoke) return;
    setRevoking(true);
    try {
      const res = await fetch(`/api/accounts/${pendingRevoke.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('failed');
      setAccounts(
        (prev) =>
          prev?.map((a) =>
            a.id === pendingRevoke.id ? { ...a, revokedAt: new Date().toISOString() } : a,
          ) ?? null,
      );
      setPendingRevoke(null);
    } catch {
      toast.error(t('settings.accounts.revokeError'));
    } finally {
      setRevoking(false);
    }
  }

  function formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return iso;
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">{t('settings.accounts.description')}</p>

      {/* Create form */}
      <div className="flex items-end gap-2 rounded-lg border p-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="new-account-name" className="text-xs">
            {t('settings.accounts.nameLabel')}
          </Label>
          <Input
            id="new-account-name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('settings.accounts.namePlaceholder')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleCreate();
              }
            }}
          />
        </div>
        <div className="w-36 space-y-1.5">
          <Label className="text-xs">{t('settings.accounts.roleLabel')}</Label>
          <Select value={newRole} onValueChange={(v) => setNewRole(v as AccountRole)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="learner">{t('settings.accounts.roleLearner')}</SelectItem>
              <SelectItem value="admin">{t('settings.accounts.roleAdmin')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
          <Plus className="h-4 w-4" />
          {t('settings.accounts.createButton')}
        </Button>
      </div>

      {/* Accounts table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="text-left font-medium px-3 py-2">{t('settings.accounts.tableName')}</th>
              <th className="text-left font-medium px-3 py-2">{t('settings.accounts.tableRole')}</th>
              <th className="text-left font-medium px-3 py-2">{t('settings.accounts.tableStatus')}</th>
              <th className="text-left font-medium px-3 py-2">{t('settings.accounts.tableCreated')}</th>
              <th className="text-right font-medium px-3 py-2">{t('settings.accounts.tableActions')}</th>
            </tr>
          </thead>
          <tbody>
            {accounts === null && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  …
                </td>
              </tr>
            )}
            {accounts !== null && accounts.length === 0 && !loadError && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                  {t('settings.accounts.emptyState')}
                </td>
              </tr>
            )}
            {loadError && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-destructive">
                  {t('settings.accounts.loadError')}
                </td>
              </tr>
            )}
            {accounts?.map((account) => (
              <tr key={account.id} className="border-t">
                <td className="px-3 py-2.5 font-medium">{account.name}</td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    {account.role === 'admin' ? (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    ) : (
                      <GraduationCap className="h-3.5 w-3.5" />
                    )}
                    {account.role === 'admin'
                      ? t('settings.accounts.roleAdmin')
                      : t('settings.accounts.roleLearner')}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {account.revokedAt ? (
                    <Badge variant="destructive">{t('settings.accounts.statusRevoked')}</Badge>
                  ) : (
                    <Badge variant="secondary">{t('settings.accounts.statusActive')}</Badge>
                  )}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{formatDate(account.createdAt)}</td>
                <td className="px-3 py-2.5 text-right">
                  {!account.revokedAt && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-destructive hover:text-destructive"
                      onClick={() => setPendingRevoke(account)}
                    >
                      {t('settings.accounts.revokeButton')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Generated-code dialog (shown exactly once, right after creation) */}
      <Dialog open={generatedCode !== null} onOpenChange={(open) => !open && setGeneratedCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.accounts.codeGeneratedTitle')}</DialogTitle>
            <DialogDescription>
              {t('settings.accounts.codeGeneratedNotice', { name: generatedCode?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('settings.accounts.codeLabel')}</Label>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
              <span className="flex-1 select-all font-mono text-sm tracking-wide">
                {generatedCode?.code}
              </span>
              <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleCopyGeneratedCode}>
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <Button className="w-full" onClick={() => setGeneratedCode(null)}>
            {t('settings.accounts.doneButton')}
          </Button>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation */}
      <AlertDialog open={pendingRevoke !== null} onOpenChange={(open) => !open && setPendingRevoke(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.accounts.revokeConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.accounts.revokeConfirmDescription', { name: pendingRevoke?.name ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.accounts.cancelButton')}</AlertDialogCancel>
            <AlertDialogAction disabled={revoking} onClick={handleConfirmRevoke}>
              {t('settings.accounts.revokeButton')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
