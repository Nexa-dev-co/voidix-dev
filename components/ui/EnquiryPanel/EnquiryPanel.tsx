'use client';

import Dialog from '@/components/ui/Dialog/Dialog';
import Drawer from '@/components/ui/Drawer/Drawer';
import EnquiryForm from '@/components/ui/EnquiryForm/EnquiryForm';
import { useIsNarrowViewport } from '@/lib/hooks/useIsNarrowViewport';
import type { EnquiryPrefill } from '@/lib/enquirySubjects';

/**
 * "Start a project", opened from wherever the visitor happened to be standing.
 *
 * One form, two shells: a pane of glass over the scene where there is room for one, and the site's
 * existing bottom sheet where there is not. The choice is `useIsNarrowViewport` — the LAYOUT question
 * (how much room is there), not `useIsLowPowerViewport`, which asks how much work the device can do.
 * A narrow window on a fast desktop wants the sheet for the same reason a phone does.
 *
 * ⚠ The form is KEYED on the subject. Its textarea seed is a `defaultValue`, which React only applies
 * at mount — so without this, opening the dialog from one service, closing it, and opening it from
 * another would present the second service under the first one's sentence. Keying on the subject rather
 * than on `open` is deliberate: reopening the SAME one keeps whatever the visitor had already typed.
 */

interface EnquiryPanelProps {
  open: boolean;
  onClose: () => void;
  /** Names what this was opened from — the craft, the project, or the room. */
  eyebrow: string;
  title: string;
  /** Omitted where there is nothing to carry in: the chamber's "ask us" opens a blank sheet. */
  prefill?: EnquiryPrefill;
  briefLabel?: string;
  submitLabel?: string;
  /** `'application'` gives careers its work fieldset and stricter required rules — see EnquiryForm. */
  variant?: 'enquiry' | 'application';
  /** Passed straight through. Only the OPEN application asks it — see EnquiryForm. */
  commitmentOptions?: readonly string[];
  commitmentLabel?: string;
}

export default function EnquiryPanel({
  open,
  onClose,
  eyebrow,
  title,
  prefill,
  briefLabel,
  submitLabel = 'Send the brief',
  variant,
  commitmentOptions,
  commitmentLabel,
}: EnquiryPanelProps) {
  const isNarrow = useIsNarrowViewport();
  const isApplication = variant === 'application';

  const form = (
    <EnquiryForm
      key={prefill?.subject ?? 'blank'}
      prefill={prefill}
      briefLabel={briefLabel}
      submitLabel={submitLabel}
      variant={variant}
      // ⚠ On an application the shell's own title IS the role, so the form's subject box would print
      // the same string a second time, 50px below the first — in the one panel that has no room to
      // spare. The hidden field carrying it to the endpoint is unaffected; only the visible box goes.
      // Everywhere else the two genuinely differ ("Start a project" over the craft you clicked), and
      // the box is the only thing naming what the message is about.
      showSubject={!isApplication}
      commitmentOptions={commitmentOptions}
      commitmentLabel={commitmentLabel}
    />
  );

  if (isNarrow) {
    return (
      <Drawer open={open} onClose={onClose} eyebrow={eyebrow} title={title}>
        {form}
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onClose={onClose} eyebrow={eyebrow} title={title} wide={isApplication}>
      {form}
    </Dialog>
  );
}
