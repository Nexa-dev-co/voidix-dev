import { useSiteContent } from '@/lib/cms/SiteContentProvider';

/**
 * The document pages' footer.
 *
 * ── ⚠ IT READS THE HOMEPAGE'S OWN LINK DATA ──────────────────────────────────────────────────────
 * `SiteContent.footer` — the same object the contact section renders. There is one list of links on
 * this site and it lives in one file; the alternative is two lists that agree today and drift the
 * first time a social handle changes. Adding the Studio group to that file put About and Careers into
 * both footers at once, which is the test of whether the sharing was worth doing.
 *
 * What is NOT shared is the presentation, because the two have completely different budgets. The
 * contact footer is squeezed into a single pinned viewport it shares with a form and a black hole, and
 * every rule in it is fighting for vertical space (there is a whole `@media (max-width: 30em)` block in
 * `globals.css` about the ~150px it once overran by). This one has a document's worth of room and can
 * simply be a footer.
 *
 * ── ⚠ NO CC-BY CREDIT HERE, AND THAT IS CORRECT ──────────────────────────────────────────────────
 * `black_hole.glb`'s licence obliges attribution wherever the work appears. It does not appear on
 * these pages — there is no WebGL on either of them at all — so the credit belongs where the model is,
 * which is the contact section. Copying it here would not be extra diligence; it would be claiming to
 * show something we don't.
 */

/**
 * ⚠ No `'use client'` of its own — it inherits one from `PageShell`, which is the only thing that
 * renders it. If that ever stops being true, this needs the directive: `useSiteContent` is a hook.
 */
export default function PageFooter() {
  const { footer } = useSiteContent();

  return (
    <footer className="doc-footer" data-reveal>
      <div className="doc-footer-top">
        <div className="doc-footer-brand">
          <span className="font-display doc-footer-mark">Voidix</span>
          <span className="doc-footer-note">{footer.tagline}</span>
        </div>

        <div className="doc-footer-groups">
          {footer.groups.map((group) => (
            <div className="doc-footer-group" key={group.title}>
              <p className="doc-footer-group-title">{group.title}</p>
              <ul className="doc-footer-links">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <a
                      className="doc-footer-link"
                      href={link.href}
                      {...(link.external ? { target: '_blank', rel: 'noreferrer' } : {})}
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <p className="doc-footer-base">{footer.signOff}</p>
    </footer>
  );
}
