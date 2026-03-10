// ═══════════════════════════════════════════════════════════════════
// VoiceForge AI — Agent Test Widget (ElevenLabs Conversational AI)
// Embeds the ElevenLabs widget to test agents via browser microphone
// Records the real conversation transcript on close
// ═══════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { X, Mic, Phone, AlertCircle, Loader2 } from 'lucide-react';
import { Button, Spinner } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { api } from '@/lib/api-client';
import { toast } from 'sonner';
import type { ApiResponse } from '@voiceforge/shared';

interface AgentTestWidgetProps {
  agentId: string; // ElevenLabs agent ID
  agentName: string;
  onClose: () => void;
}

const WIDGET_SCRIPT_URL = 'https://elevenlabs.io/convai-widget/index.js';

export function AgentTestWidget({ agentId, agentName, onClose }: AgentTestWidgetProps) {
  const { t } = useI18n();
  const [isScriptLoaded, setIsScriptLoaded] = useState(false);
  const [scriptError, setScriptError] = useState(false);
  const [micPermission, setMicPermission] = useState<'pending' | 'granted' | 'denied'>('pending');
  const [isRecording, setIsRecording] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetMountedRef = useRef(false);

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

    script.onload = () => {
      setIsScriptLoaded(true);
    };

    script.onerror = () => {
      setScriptError(true);
    };

    document.head.appendChild(script);
  }, []);

  // Mount the custom element imperatively when script is loaded.
  // Small delay avoids "signal is aborted" error caused by React Strict Mode
  // double-mount cycle aborting the first fetch before the widget initializes.
  useEffect(() => {
    if (!isScriptLoaded || scriptError || !widgetContainerRef.current) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled || !widgetContainerRef.current) return;
      const el = document.createElement('elevenlabs-convai');
      el.setAttribute('agent-id', agentId);
      widgetContainerRef.current.innerHTML = '';
      widgetContainerRef.current.appendChild(el);
      widgetMountedRef.current = true;
    }, 50);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (widgetContainerRef.current) {
        widgetContainerRef.current.innerHTML = '';
      }
    };
  }, [isScriptLoaded, scriptError, agentId]);

  // Check microphone permission
  useEffect(() => {
    const checkMic = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Immediately stop tracks — we just wanted permission
        stream.getTracks().forEach((t) => t.stop());
        setMicPermission('granted');
      } catch {
        setMicPermission('denied');
      }
    };

    checkMic();
  }, []);

  // Record the conversation when widget closes.
  // The backend handles internal polling (up to ~27s) waiting for ElevenLabs
  // to finalize the AI analysis (summary, data collection, evaluation).
  // Frontend waits 5s for the conversation to appear, then makes one call.
  // One retry if the first attempt returns no conversation.
  const handleClose = useCallback(async () => {
    if (!widgetMountedRef.current) {
      onClose();
      return;
    }

    setIsRecording(true);

    // Initial delay: let ElevenLabs register the conversation
    await new Promise((r) => setTimeout(r, 5000));

    let recorded = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const result = await api.post<ApiResponse<{ status?: string; id?: string; summary?: string; appointmentBooked?: boolean } | null>>(
          '/api/calls/record-conversation',
          { elevenlabsAgentId: agentId },
        );

        if (result.success && result.data) {
          if (result.data.status === 'recorded') {
            toast.success(t.testWidget.conversationRecorded);
            if (result.data.appointmentBooked) {
              toast.success(t.testWidget.appointmentDetected);
            }
            recorded = true;
            break;
          }
          if (result.data.status === 'no_new_conversation' && attempt === 0) {
            // Conversation not in ElevenLabs yet — wait more and retry
            console.info('[AgentTestWidget] No conversation found yet, retrying after delay...');
            await new Promise((r) => setTimeout(r, 6000));
            continue;
          }
        }

        // Any other response on last attempt — give up
        break;
      } catch (err) {
        console.warn(`[AgentTestWidget] Record attempt ${attempt + 1} failed:`, err);
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 6000));
          continue;
        }
      }
    }

    if (!recorded) {
      toast.error(t.testWidget.widgetLoadError);
    }

    setIsRecording(false);
    onClose();
  }, [agentId, onClose, t]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4">
      <div className="bg-surface rounded-2xl shadow-modal w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
              <Phone className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-text-primary">
                {t.testWidget.title}: {agentName}
              </h2>
              <p className="text-xs text-text-tertiary">
                {t.testWidget.subtitle}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={isRecording}
            className="p-1 rounded-lg hover:bg-surface-tertiary text-text-tertiary disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6" ref={containerRef}>
          {/* Recording in progress */}
          {isRecording && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
              <p className="text-sm text-text-secondary font-medium">{t.testWidget.savingConversation}</p>
            </div>
          )}

          {/* Microphone denied warning */}
          {!isRecording && micPermission === 'denied' && (
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
          {!isRecording && !isScriptLoaded && !scriptError && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Spinner size="lg" />
              <p className="text-sm text-text-tertiary">{t.testWidget.loadingWidget}</p>
            </div>
          )}

          {/* Script error */}
          {!isRecording && scriptError && (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <AlertCircle className="w-10 h-10 text-danger-400" />
              <p className="text-sm text-danger-600 font-medium">
                {t.testWidget.widgetLoadError}
              </p>
              <p className="text-xs text-text-tertiary max-w-xs">
                {t.testWidget.widgetLoadErrorDescription}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                {t.common.refresh}
              </Button>
            </div>
          )}

          {/* ElevenLabs widget */}
          {!isRecording && isScriptLoaded && !scriptError && (
            <div className="flex flex-col items-center gap-4">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                <Mic className="w-3.5 h-3.5" />
                <span>{t.testWidget.widgetActive}</span>
              </div>

              {/* The actual ElevenLabs widget (mounted imperatively) */}
              <div
                ref={widgetContainerRef}
                className="w-full min-h-[120px] flex items-center justify-center"
              />

              <p className="text-xs text-text-tertiary text-center max-w-sm">
                {t.testWidget.pressButton}
                {' '}{t.testWidget.voiceResponse}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex justify-end">
          <Button variant="outline" onClick={handleClose} disabled={isRecording}>
            {isRecording ? t.testWidget.savingConversation : t.common.close}
          </Button>
        </div>
      </div>
    </div>
  );
}
