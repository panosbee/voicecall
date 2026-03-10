// ═══════════════════════════════════════════════════════════════════
// Onboarding Step 3 — Agent Configuration
// Name, greeting, instructions, voice selection
// ═══════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useCallback, type FormEvent } from 'react';
import { Button, Input, Textarea, Select } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { KnowledgeBaseUpload } from '@/components/knowledge-base-upload';
import { GREEK_VOICES, INDUSTRY_TEMPLATES, getTemplateContent } from '@voiceforge/shared';
import type { OnboardingData } from './page';
import type { KBDocumentSummary, Industry } from '@voiceforge/shared';

interface StepAgentProps {
  data: OnboardingData;
  updateData: (partial: Partial<OnboardingData>) => void;
  onNext: () => void;
  onBack: () => void;
}

/** Generate default greeting and instructions based on industry + locale */
function getDefaults(industry: string, businessName: string, locale: string) {
  const template = INDUSTRY_TEMPLATES[industry as Industry];
  if (template) {
    const content = getTemplateContent(template, locale);
    // Replace business name placeholder in greeting
    const greeting = content.greeting.replace(
      /στο (δικηγορικό γραφείο|ιατρείο|οδοντιατρείο|μεσιτικό μας γραφείο|κτηνιατρείο|λογιστικό γραφείο|the law office|the medical practice|the dental clinic|our real estate agency|the veterinary clinic|the accounting office)/i,
      locale.startsWith('en') ? `at ${businessName}` : `στο ${businessName}`,
    );
    return { agentName: content.agentName, greeting, instructions: content.instructions };
  }

  // Fallback for unknown industry
  const isEn = locale.startsWith('en');
  const greeting = isEn
    ? `Hello, welcome to ${businessName}! My name is {{agent_name}} and I'm your digital assistant. How can I help you?`
    : `Γεια σας, καλωσορίσατε στο ${businessName}! Με λένε {{agent_name}} και είμαι η ψηφιακή βοηθός σας. Πώς μπορώ να σας εξυπηρετήσω;`;

  const instructions = isEn
    ? `You are the digital receptionist for "${businessName}".

Basic rules:
- Always be polite and professional
- If the caller asks something you don't know, say someone from the office will call back
- ALWAYS call check_availability before booking — then call book_appointment with: date, time, name, phone
- Always ask for the caller's full name and phone number before booking
- Keep your answers short (1-2 sentences maximum)`
    : `Είσαι η ψηφιακή βοηθός (ρεσεψιονίστ) για "${businessName}".

Βασικοί κανόνες:
- Μίλα ΠΑΝΤΑ στα ελληνικά, με ευγενικό και επαγγελματικό ύφος
- Χρησιμοποίησε τον πληθυντικό ευγενείας
- Αν ο καλών ρωτήσει κάτι που δεν γνωρίζεις, πες ότι θα τον καλέσει πίσω κάποιος από το γραφείο
- ΠΑΝΤΑ κάλεσε check_availability πριν κλείσεις ραντεβού — μετά κάλεσε book_appointment με: ημερομηνία, ώρα, όνομα, τηλέφωνο
- Ζήτα πάντα το ονοματεπώνυμο και τον αριθμό τηλεφώνου πριν κλείσεις ραντεβού
- Κράτα σύντομες τις απαντήσεις σου (1-2 προτάσεις maximum)`;

  return { agentName: isEn ? 'Sophia' : 'Σοφία', greeting, instructions };
}

// voiceOptions built inside component to use i18n

export function StepAgent({ data, updateData, onNext, onBack }: StepAgentProps) {
  const { t, locale } = useI18n();

  const voiceOptions = GREEK_VOICES.map((v) => ({
    value: v.id,
    label: `${v.name} (${v.gender === 'female' ? t.onboarding.femaleVoice : t.onboarding.maleVoice})`,
  }));

  // Auto-fill defaults when user first lands on this step
  useEffect(() => {
    if (!data.greeting && !data.instructions && data.industry) {
      const defaults = getDefaults(data.industry, data.businessName, locale);
      updateData({
        agentName: defaults.agentName,
        greeting: defaults.greeting,
        instructions: defaults.instructions,
      });
    }
  }, [data.greeting, data.instructions, data.industry, data.businessName, locale, updateData]);

  // Track KB document IDs for agent creation
  const handleKBDocumentsChange = useCallback((docs: KBDocumentSummary[]) => {
    const docIds = docs.map((d) => d.elevenlabsDocId);
    updateData({ kbDocumentIds: docIds });
  }, [updateData]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onNext();
  };

  const isValid = data.agentName && data.greeting && data.instructions && data.voiceId;

  return (
    <div className="bg-surface border border-border rounded-xl shadow-card p-8">
      <h2 className="text-xl font-semibold text-text-primary mb-2">{t.onboarding.agentTitle}</h2>
      <p className="text-sm text-text-secondary mb-6">
        {t.onboarding.agentSubtitle1} {t.onboarding.agentSubtitle2}
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label={t.onboarding.agentNameLabel}
            placeholder={t.onboarding.agentNamePlaceholder}
            value={data.agentName}
            onChange={(e) => updateData({ agentName: e.target.value })}
            hint={t.onboarding.agentNameHint}
            required
          />
          <Select
            label={t.onboarding.voiceLabel}
            options={voiceOptions}
            value={data.voiceId}
            onChange={(e) => updateData({ voiceId: e.target.value })}
            hint={t.onboarding.voiceHint}
          />
        </div>

        <Textarea
          label={t.onboarding.greetingLabel}
          placeholder={t.onboarding.greetingPlaceholder}
          value={data.greeting}
          onChange={(e) => updateData({ greeting: e.target.value })}
          hint={t.onboarding.greetingHint}
          rows={3}
          required
        />

        <Textarea
          label={t.onboarding.instructionsLabel}
          placeholder={t.onboarding.instructionsPlaceholder}
          value={data.instructions}
          onChange={(e) => updateData({ instructions: e.target.value })}
          hint={t.onboarding.instructionsHint}
          rows={12}
          required
        />

        {/* Knowledge Base Upload */}
        <div className="border-t border-border pt-5">
          <h3 className="text-sm font-semibold text-text-primary mb-1">{t.onboarding.kbOptional}</h3>
          <p className="text-xs text-text-tertiary mb-3">
            {t.onboarding.kbUploadHint}
          </p>
          <KnowledgeBaseUpload
            agentId={null}
            onDocumentsChange={handleKBDocumentsChange}
            compact
          />
        </div>

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={onBack} type="button">
            {t.common.back}
          </Button>
          <Button type="submit" disabled={!isValid}>
            {t.common.next}
          </Button>
        </div>
      </form>
    </div>
  );
}
