/**
 * Contact — the last overlay in the hero's single pin.
 *
 * You leave the room by going back INTO the display, and the space you land in is the one you browsed
 * projects in: same stars, same debris, same camera angle you left it at. What has changed is what is
 * missing — the mark is gone and the star is a black hole — and the starfield's tails, which sell a
 * fall toward it without the camera moving at all. See docs/contact-black-hole-plan.md.
 *
 * ⚠ STEP 1 OF THE PLAN. This is the shell only: it exists so the return crossing has something to fade
 * and so the navbar's fourth meter (which has declared `key: 'contact'` since it was written, pointing
 * at nothing) has a section to feed it. The form, the footer and the black hole are steps 3 and 4.
 *
 * Like every other section past the hero this is an absolutely-positioned overlay inside `.hero-section`
 * rather than a block in the page — there is exactly one pin on this site, and everything lives in it.
 */
export default function ContactSection() {
  return (
    <section id="contact" className="contact-section" aria-label="Contact">
      <div className="contact-panel">
        <p className="eyebrow">Start a project</p>
      </div>
    </section>
  );
}
