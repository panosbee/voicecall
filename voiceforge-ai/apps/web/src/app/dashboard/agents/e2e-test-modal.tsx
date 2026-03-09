// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — E2E Test Modal
// Real conversation with Agent via ElevenLabs widget
// Call records auto-created via webhook → appear in Dashboard, Calls & Calendar
// ═══════════════════════════════════════════════════════════════════

'use client';

import { useState, useEffect, useRef } from 'react';
import { Button, Spinner } from '@/components/ui';
import { api } from '@/lib/api-client';
import { useI18n } from '@/lib/i18n';
import { X, FlaskConical, Mic, Trash2, AlertCircle, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { ApiResponse } from '@voiceforge/shared';

const WIDGET_SCRIPT_URL = 'https://elevenlabs.io/convai-widget/index.js';

interface E2ETestModalProps {
  agentId: string;
  elevenlabsAgentId: string;
  agentName: string;
  onClose: () => void;
}

export function E2ETestModal({ agentId, elevenlabsAgentId, agentName, onClose }: E2ETestModalProps) {
  const { t } = useI18n();

  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [micPermission, setMicPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [isDeleting, setIsDeleting] = useState(false);
  const [conversationDone, setConversationDone] = useState(false);
  const widgetContainerRef = useRef<HTMLDivElement>(null);

  // Load the ElevenLabs widget script
  useEffect(() => {
    const existingScript = document.querySelector(`script[src="${WIDGET_SCRIPT_URL}"]`);
    if (existingScript) {
      setIsScriptLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = WIDGET_SCRIPT_URL;
    script.async = true;
    script.type = 'text/javascript';
    script.onload = () => setIsScriptLoaded(true);
    script.onerror = () => setScriptError(true);
    document.head.appendChild(script);
  }, []);

  // Mount the custom element when script is loaded
  useEffect(() => {
    if (!isScriptLoaded || scriptError || !widgetContainerRef.current) return;

    const el = document.createElement('elevenlabs-convai');
    el.setAttribute('agent-id', elevenlabsAgentId);
    widgetContainerRef.current.innerHTML = '';
    widgetContainerRef.current.appendChild(el);

    // Listen for conversation end event
    const handleEnd = () => setConversationDone(true);
    el.addEventListener('elevenlabs-convai:call-ended', handleEnd);
    el.addEventListener('elevenlabs-convai:conversation-ended', handleEnd);

    return () => {
      el.removeEventListener('elevenlabs-convai:call-ended', handleEnd);
      el.removeEventListener('elevenlabs-convai:conversation-ended', handleEnd);
      if (widgetContainerRef.current) {
        widgetContainerRef.current.innerHTML = '';
      }
    };
  }, [isScriptLoaded, scriptError, elevenlabsAgentId]);

  // Check microphone permission
  useEffect(() => {
    const checkMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        setMicPermission('granted');
      } catch {
        setMicPermission('denied');
      }
    };
    checkMic();
  }, []);

  const handleDeleteAll = async () => {
    if (!confirm(t.agents.e2eTestDeleteAllConfirm)) return;
    setIsDeleting(true);
    try {
      const result = await api.delete<ApiResponse<{ deletedCount: number }>>('/api/calls/e2e-test');
      if (result.success && result.data) {
        toast.success(`${result.data.deletedCount} ${t.agents.e2eTestDeletedAll}`);
      }
    } catch {
      toast.error(t.agents.e2eTestDeleteError);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
      <div className="bg-surface rounded-2xl shadow-modal w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
              <FlaskConical className="w-4 h-4 text-amber-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                {t.agents.e2eTest}: {agentName}
              </h2>
              <p className="text-xs text-text-tertiary">
                {t.agents.e2eTestDescription}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-surface-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {/* Microphone denied warning */}
          {micPermission === 'denied' && (
            <div className="flex items-start gap-3 p-4 mb-4 rounded-lg bg-warning-50 border border-warning-200">
              <AlertCircle className="w-5 h-5 text-warning-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-warning-700">
                  {t.testWidget.micUnavailable}
                </p>
                <p className="text-xs text-warning-600 mt-1">
                  {t.testWidget.micUnavailableDescription}
                </p>
              </div>
            </div>
          )}

          {/* Script loading */}
          {!isScriptLoaded && !scriptError && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-sm text-text-tertiary">{t.testWidget.loadingWidget}</p>
            </div>
          )}

          {/* Script error */}
          {scriptError && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <AlertCircle className="w-10 h-10 text-danger-400" />
              <p className="text-sm text-danger-600 font-medium">
                {t.testWidget.widgetLoadError}
              </p>
            </div>
          )}

          {/* ElevenLabs widget — real conversation */}
          {isScriptLoaded && !scriptError && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                <Mic className="w-3.5 h-3.5" />
                <span>{t.agents.e2eTestLive}</span>
              </div>

              {/* The actual ElevenLabs widget */}
              <div
                ref={widgetContainerRef}
                className="w-full min-h-[120px] flex items-center justify-center"
              />

              <p className="text-xs text-text-tertiary text-center max-w-sm">
                {t.agents.e2eTestHint}
              </p>
            </div>
          )}

          {/* Conversation completed */}
          {conversationDone && (
            <div className="flex items-center gap-2 mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <span className="text-sm text-green-700">{t.agents.e2eTestSuccess}</span>
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

          <Button variant="outline" onClick={onClose}>
            {t.common.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
