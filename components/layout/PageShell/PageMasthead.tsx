import type { CSSProperties } from 'react';

/**
 * The top of a document page: kicker, display title, a rule that draws itself, and the lead.
 *
 * ── ⚠ THE TITLE IS AN ARRAY OF SENTENCES, NOT A STRING WITH A <br/> IN IT ────────────────────────
 * `CLAUDE.md` records what a hard break in a headline does to a 360px screen: the fleet's title came
 * out as "One craft at / a time. / Bring it / online." — because a `<br/>` is a DESKTOP instruction
 * that compounds with the natural wrap instead of replacing it. Each sentence gets its own span and
 * `text-wrap: balance` evens whatever lines it actually needs at that width.
 *
 * ── The lead is offset, not centred under the title ──────────────────────────────────────────────
 * Everything stacked on one axis is the template look. Hanging the lead into the right half sets the
 * page against a diagonal instead, which is the composition the deck's head and the works head both
 * already use — a wide left title with its detail held off to one side.
 *
 * ── ⚠ THE STAR IS CSS, AND IT IS THE PAGE'S ANCHOR IMAGE ─────────────────────────────────────────
 * These routes carry no WebGL by decision (`PageShell`'s header has the budget reasoning), which for a
 * while meant they carried no image at all — a page whose entire visual weight was typography and
 * hairlines. This is the answer that costs nothing: gradients, in the dead space the offset lead opens
 * up at the top right, tying the document routes to the homepage's sun without a second GL context.
 *
 * It is not a picture of the sun and should not become one. It is the same LIGHT, seen from further
 * away — which is also why it dims as you descend the page (`--doc-progress`): you are travelling away
 * from the top of the document, and the one thing on screen that came from the hero goes with you.
 */

interface PageMastheadProps {
  eyebrow: string;
  /** One entry per sentence. See the header — never a string with a break in it. */
  title: readonly string[];
  lead: string;
}

export default function PageMasthead({ eyebrow, title, lead }: PageMastheadProps) {
  return (
    <header className="doc-masthead" data-reveal>
      {/* Decorative and nothing but — the page says what it is in the title beneath it. */}
      <span className="doc-masthead-star" aria-hidden="true">
        <span className="doc-masthead-star-corona" />
        <span className="doc-masthead-star-core" />
      </span>

      <p className="eyebrow doc-masthead-eyebrow">{eyebrow}</p>

      <h1 className="font-display doc-masthead-title">
        {title.map((sentence, index) => (
          <span
            key={sentence}
            className="doc-masthead-line"
            style={{ '--reveal-index': index } as CSSProperties}
          >
            {sentence}
          </span>
        ))}
      </h1>

      <span className="doc-masthead-rule" aria-hidden="true" />

      <p className="doc-masthead-lead">{lead}</p>
    </header>
  );
}
