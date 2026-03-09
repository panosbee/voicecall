// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — E2E Test Modal
// Simulate a complete call lifecycle without needing Telnyx
// Creates test call records visible in Dashboard, Calls & Calendar
// ═══════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { Button, Select, Spinner } from '@/components/ui';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n';
import { X, FlaskConical, CheckCircle, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiResponse } from '@voiceforge/shared';

interface E2ETestModalProps {
  agentId: string;
  agentName: string;
  onClose: () => void;
}

export function E2ETestModal({ agentId, agentName, onClose }: E2ETestModalProps) {
  const { t, locale } = useI18n();

  const [status, setStatus] = useState<'completed' | 'missed' | 'voicemail' | 'failed'>('completed');
  const [sentiment, setSentiment] = useState(4);
  const [appointmentBooked, setAppointmentBooked] = useState(false);
  const [durationSeconds, setDurationSeconds] = useState(45);

  const [isRunning, setIsRunning] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [lastResult, setLastResult] = useState<{ id: string } | null>(null);

  const handleRunTest = async () => {
    setIsRunning(true);
    setLastResult(null);
    try {
      const result = await api.post<ApiResponse<{ id: string; status: string; durationSeconds: number }>>(
        '/api/calls/e2e-test',
        {
          agentId,
          status,
          sentiment,
          appointmentBooked,
          durationSeconds,
          locale,
        },
      );
      if (result.success && result.data) {
        setLastResult({ id: result.data.id });
        toast.success(t.agents.e2eTestSuccess);
      }
    } catch {
      toast.error(t.agents.e2eTestError);
    } finally {
      setIsRunning(false);
    }
  };

  const handleDeleteLast = async () => {
    if (!lastResult) return;
    try {
      await api.delete<ApiResponse<{ deleted: boolean }>>(`/api/calls/e2e-test/${lastResult.id}`);
      toast.success(t.agents.e2eTestDeleted);
      setLastResult(null);
    } catch {
      toast.error(t.agents.e2eTestDeleteError);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(t.agents.e2eTestDeleteAllConfirm)) return;
    setIsDeleting(true);
    try {
      const result = await api.delete<ApiResponse<{ deletedCount: number }>>('/api/calls/e2e-test');
      if (result.success && result.data) {
        toast.success(`${result.data.deletedCount} ${t.agents.e2eTestDeletedAll}`);
        setLastResult(null);
      }
    } catch {
      toast.error(t.agents.e2eTestDeleteError);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-surface rounded-2xl shadow-modal w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FlaskConical className="w-5 h-5 text-amber-600" />
            <h2 className="text-lg font-semibold text-text-primary">
              {t.agents.e2eTest}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <p className="text-sm text-text-secondary">
            {t.agents.e2eTestDescription}
          </p>

          {/* Agent name */}
          <div className="text-sm font-medium text-text-primary bg-surface-secondary rounded-lg px-3 py-2">
            Agent: <span className="text-brand-600">{agentName}</span>
          </div>

          {/* Options */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-text-primary">
              {t.agents.e2eTestOptions}
            </h3>

            {/* Status */}
            <Select
              label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
              options={[
                { value: 'completed', label: t.agents.e2eTestStatusCompleted },
                { value: 'missed', label: t.agents.e2eTestStatusMissed },
                { value: 'voicemail', label: 'Voicemail' },
                { value: 'failed', label: 'Failed' },
              ]}
            />

            {/* Sentiment */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-primary">
                Sentiment ({sentiment}/5)
              </label>
              <input
                type="range"
                min={1}
                max={5}
                value={sentiment}
                onChange={(e) => setSentiment(Number(e.target.value))}
                className="w-full accent-brand-600"
              />
              <div className="flex justify-between text-xs text-text-tertiary">
                <span>1 😠</span>
                <span>3 😐</span>
                <span>5 😊</span>
              </div>
            </div>

            {/* Duration */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-text-primary">
                Duration ({durationSeconds}s)
              </label>
              <input
                type="range"
                min={5}
                max={300}
                step={5}
                value={durationSeconds}
                onChange={(e) => setDurationSeconds(Number(e.target.value))}
                className="w-full accent-brand-600"
              />
            </div>

            {/* Appointment toggle */}
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={appointmentBooked}
                onChange={(e) => setAppointmentBooked(e.target.checked)}
                className="w-4 h-4 rounded border-border text-brand-600 focus:ring-brand-500"
              />
              <span className="text-sm text-text-primary">{t.agents.e2eTestWithAppointment}</span>
            </label>
          </div>

          {/* Success indicator */}
          {lastResult && (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 text-sm text-green-700">
                <CheckCircle className="w-4 h-4" />
                {t.agents.e2eTestSuccess}
              </div>
              <button
                onClick={handleDeleteLast}
                className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors"
                title={t.agents.e2eTestDelete}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-surface-secondary/50">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteAll}
            disabled={isDeleting}
            className="text-danger-500 hover:text-danger-600"
            leftIcon={isDeleting ? <Spinner className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
          >
            {t.agents.e2eTestDeleteAll}
          </Button>

          <Button
            onClick={handleRunTest}
            disabled={isRunning}
            leftIcon={isRunning ? <Spinner className="w-4 h-4" /> : <FlaskConical className="w-4 h-4" />}
          >
            {isRunning ? t.agents.e2eTestRunning : t.agents.e2eTestRun}
          </Button>
        </div>
      </div>
    </div>
  );
}
