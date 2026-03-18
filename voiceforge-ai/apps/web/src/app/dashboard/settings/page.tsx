// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — Settings Page
// Profile editing, plan info, account actions
// ═══════════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect, type FormEvent } from 'react';
import { Card, PageHeader, Button, Input, Select, Badge } from '@/components/ui';
import { useAuthStore } from '@/stores/auth-store';
import { api } from '@/lib/api-client';
import { getIndustryLabels, getPlanLabels } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { Save, User, Building2, CreditCard, Shield, CalendarSync, RefreshCw, Link2, CheckCircle2, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { CustomerProfile, ApiResponse } from '@voiceforge/shared';

export default function SettingsPage() {
  const { t } = useI18n();
  const industryLabels = getIndustryLabels(t);
  const planLabels = getPlanLabels(t);
  const industryOpts = Object.entries(industryLabels).map(([value, label]) => ({ value, label }));

  const { profile, setProfile } = useAuthStore();

  const [businessName, setBusinessName] = useState(profile?.businessName ?? '');
  const [ownerName, setOwnerName] = useState(profile?.ownerName ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [timezone, setTimezone] = useState(profile?.timezone ?? 'Europe/Athens');
  const [isSaving, setIsSaving] = useState(false);

  // iCal state
  const [icalUrl, setIcalUrl] = useState('');
  const [icalLastSynced, setIcalLastSynced] = useState<string | null>(null);
  const [icalEventCount, setIcalEventCount] = useState(0);
  const [icalSaving, setIcalSaving] = useState(false);
  const [icalSyncing, setIcalSyncing] = useState(false);
  const [icalLoaded, setIcalLoaded] = useState(false);

  // Load iCal settings on mount
  useEffect(() => {
    api.get<ApiResponse<{ icalFeedUrl: string | null; lastSyncedAt: string | null; cachedEventCount: number }>>('/api/customers/ical-settings')
      .then((res) => {
        if (res.success && res.data) {
          setIcalUrl(res.data.icalFeedUrl ?? '');
          setIcalLastSynced(res.data.lastSyncedAt);
          setIcalEventCount(res.data.cachedEventCount);
        }
      })
      .catch(() => {})
      .finally(() => setIcalLoaded(true));
  }, []);

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);

    try {
      const result = await api.patch<ApiResponse<CustomerProfile>>('/api/customers/me', {
        businessName,
        ownerName,
        phone,
        timezone,
      });

      if (result.success && result.data) {
        setProfile(result.data);
        toast.success(t.settings.saveSuccess);
      }
    } catch {
      toast.error(t.settings.saveError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveIcal = async () => {
    setIcalSaving(true);
    try {
      const result = await api.put<ApiResponse<{ icalFeedUrl: string | null }>>('/api/customers/ical-settings', {
        icalFeedUrl: icalUrl.trim() || null,
      });
      if (result.success) {
        toast.success('iCal URL αποθηκεύτηκε');
        if (!icalUrl.trim()) {
          setIcalLastSynced(null);
          setIcalEventCount(0);
        }
      }
    } catch {
      toast.error('Σφάλμα αποθήκευσης iCal URL');
    } finally {
      setIcalSaving(false);
    }
  };

  const handleSyncIcal = async () => {
    setIcalSyncing(true);
    try {
      const result = await api.post<ApiResponse<{ total: number; synced: number; syncedAt: string }>>('/api/customers/ical-sync', {});
      if (result.success && result.data) {
        setIcalLastSynced(result.data.syncedAt);
        setIcalEventCount(result.data.synced);
        toast.success(`Συγχρονίστηκαν ${result.data.synced} events από ${result.data.total} συνολικά`);
      }
    } catch {
      toast.error('Αποτυχία σύνδεσης με το iCal feed. Ελέγξτε το URL.');
    } finally {
      setIcalSyncing(false);
    }
  };

  const planInfo = planLabels[profile?.plan ?? 'basic']!;

  return (
    <div>
      <PageHeader title={t.settings.title} description={t.settings.description} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Form */}
        <div className="lg:col-span-2 space-y-6">
          <Card padding="md">
            <div className="flex items-center gap-2 mb-6">
              <User className="w-5 h-5 text-brand-500" />
              <h3 className="font-semibold text-text-primary">{t.settings.profile}</h3>
            </div>

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <Input
                label={t.settings.businessName}
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                required
              />
              <Input
                label={t.settings.ownerName}
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                required
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label={t.settings.email}
                  value={profile?.email ?? ''}
                  disabled
                  hint={t.settings.emailNoChange}
                />
                <Input
                  label={t.settings.phone}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
              <Select
                label={t.settings.timezone}
                options={[
                  { value: 'Europe/Athens', label: t.settings.greece },
                  { value: 'Europe/Nicosia', label: t.settings.cyprus },
                ]}
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
              />
              <div className="flex justify-end pt-2">
                <Button type="submit" isLoading={isSaving} leftIcon={<Save className="w-4 h-4" />}>
                  {t.common.save}
                </Button>
              </div>
            </form>
          </Card>

          {/* iCal Calendar Integration */}
          <Card padding="md">
            <div className="flex items-center gap-2 mb-6">
              <CalendarSync className="w-5 h-5 text-brand-500" />
              <h3 className="font-semibold text-text-primary">Σύνδεση Ημερολογίου (iCal)</h3>
            </div>

            <p className="text-sm text-text-secondary mb-4">
              Συνδέστε το Google Calendar, Outlook ή Apple Calendar μέσω iCal URL.
              Ο AI βοηθός θα ελέγχει τη διαθεσιμότητά σας αυτόματα πριν κλείσει ραντεβού.
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  iCal Feed URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={icalUrl}
                    onChange={(e) => setIcalUrl(e.target.value)}
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    className="flex-1 rounded-lg border border-border bg-bg-primary px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500"
                  />
                  <Button
                    onClick={handleSaveIcal}
                    isLoading={icalSaving}
                    variant="secondary"
                    leftIcon={<Link2 className="w-4 h-4" />}
                  >
                    Αποθήκευση
                  </Button>
                </div>
              </div>

              {/* Sync status */}
              {icalLoaded && icalUrl && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary border border-border">
                  <div className="flex items-center gap-3">
                    {icalLastSynced ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-amber-500" />
                    )}
                    <div>
                      <p className="text-sm text-text-primary font-medium">
                        {icalLastSynced
                          ? `${icalEventCount} events συγχρονισμένα`
                          : 'Δεν έχει γίνει συγχρονισμός'}
                      </p>
                      {icalLastSynced && (
                        <p className="text-xs text-text-tertiary">
                          Τελευταίος: {new Date(icalLastSynced).toLocaleString('el-GR')}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={handleSyncIcal}
                    isLoading={icalSyncing}
                    size="sm"
                    variant="secondary"
                    leftIcon={<RefreshCw className="w-4 h-4" />}
                  >
                    Συγχρονισμός
                  </Button>
                </div>
              )}

              {/* Help text */}
              <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                <p className="text-xs text-blue-700 dark:text-blue-300 font-medium mb-1">
                  Πώς βρίσκω το iCal URL;
                </p>
                <ul className="text-xs text-blue-600 dark:text-blue-400 space-y-1 list-disc list-inside">
                  <li><strong>Google Calendar:</strong> Ρυθμίσεις → Ημερολόγιο → &quot;Μυστική διεύθυνση σε μορφή iCal&quot;</li>
                  <li><strong>Outlook:</strong> Ρυθμίσεις → Ημερολόγιο → Κοινοποίηση → &quot;Publish to ICS&quot;</li>
                  <li><strong>Apple Calendar:</strong> Κοινοποίηση ημερολογίου → Δημόσιο ημερολόγιο → URL</li>
                </ul>
              </div>
            </div>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Plan Info */}
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <CreditCard className="w-5 h-5 text-brand-500" />
              <h3 className="font-semibold text-text-primary">{t.settings.plan}</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t.settings.currentPlan}</span>
                <Badge variant="brand">{planInfo.name}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t.settings.price}</span>
                <span className="text-sm font-medium text-text-primary">{planInfo.price}{t.common.perMonth}</span>
              </div>
              <p className="text-xs text-text-tertiary pt-2">{planInfo.description}</p>
            </div>
          </Card>

          {/* Account Status */}
          <Card padding="md">
            <div className="flex items-center gap-2 mb-4">
              <Shield className="w-5 h-5 text-brand-500" />
              <h3 className="font-semibold text-text-primary">{t.settings.account}</h3>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t.settings.statusLabel}</span>
                <Badge variant={profile?.isActive ? 'success' : 'danger'}>
                  {profile?.isActive ? t.settings.active : t.settings.inactive}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t.settings.elevenLabsAI}</span>
                <Badge variant={profile?.hasElevenLabsAgents ? 'success' : 'default'}>
                  {profile?.hasElevenLabsAgents ? t.settings.activeStatus : t.settings.noAgents}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t.settings.aiAssistants}</span>
                <span className="text-sm font-medium text-text-primary">{profile?.agentCount ?? 0}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t.settings.telephony}</span>
                <Badge variant={profile?.hasTelnyxAccount ? 'success' : 'default'}>
                  {profile?.hasTelnyxAccount ? t.settings.connected : t.settings.notConfigured}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-text-secondary">{t.settings.industryLabel}</span>
                <span className="text-sm text-text-primary">
                  {industryLabels[profile?.industry ?? ''] ?? profile?.industry}
                </span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
