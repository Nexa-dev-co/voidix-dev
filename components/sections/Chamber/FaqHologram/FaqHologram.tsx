'use client';

import { useEffect, useRef, useState } from 'react';
import { CHAMBER_HOLOGRAM_EVENT, readHologramOpen } from '@/lib/chamberEvents';
import { SECTION_ARRIVE_EVENT, readSectionArriveKey } from '@/lib/sectionJumpEvents';
import { FAQ_ENTRIES } from '@/components/sections/Chamber/faqEntries';
import { useHologramTracking } from './hooks/useHologramTracking';
import { useHologramReveal } from './hooks/useHologramReveal';
import { useHologramScrollGuard } from './hooks/useHologramScrollGuard';

/**
 * The FAQ hologram — the room's answer to you, floating above the podium's plinth.
 *
 * It is DOM, not WebGL, and that is a decision rather than a shortcut: everything it does — a height
 * decided by its contents, a scroll area when an answer runs long, clickable rows, selectable text — is
 * a text-layout problem, and WebGL would mean re-implementing layout, hit-testing and scrolling by hand.
 * The holographic *look* is CSS. What keeps it from being a sticker on the glass is that it's anchored to
 * a point in the 3D room: the chamber scene projects that anchor through its camera and the tracking hook
 * places the panel on it, so the panel grows as the camera walks up to it and drifts with the camera's
 * handheld sway. See lib/hologramPose.ts.
 *
 * It lives in `page.tsx`, OUTSIDE the hero — deliberately. The hero is pinned, and ScrollTrigger wraps a
 * pinned section in a transformed spacer; a transformed ancestor turns `position: fixed` into something
 * that behaves like `absolute`, and the panel would drift off with the page.
 *
 * The two black frames are flex siblings of the lit area, so the content parts them by simply existing.
 */
/** The navbar/carousel key the chamber answers to — the room is what "Process" means on this site. */
const CHAMBER_SECTION_KEY = 'process';

export default function FaqHologram() {
  const panelRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [openEntry, setOpenEntry] = useState<number | null>(null);

  // The SCENE owns whether the panel is open, not the scroll — it unseals the moment the showcase tour
  // finishes walking you up to the podium, which is the end of a timeline rather than a scroll position.
  // Scrolling back out of the room re-seals it.
  useEffect(() => {
    const handleHologram = (event: Event) => setIsOpen(readHologramOpen(event));
    window.addEventListener(CHAMBER_HOLOGRAM_EVENT, handleHologram);
    return () => window.removeEventListener(CHAMBER_HOLOGRAM_EVENT, handleHologram);
  }, []);

  // Re-sealing always returns to the list, so re-opening it never lands you mid-answer in a panel you
  // last saw closed.
  useEffect(() => {
    if (!isOpen) setOpenEntry(null);
  }, [isOpen]);

  // ── Arriving here by a covered nav jump ──
  // The unseal above is cued by the TOUR landing, and on a jump the tour runs behind the cover — so the
  // panel is already standing open by the time the hole lets you see it, its whole entrance spent where
  // nobody was. Bumping this replays it, rather than dressing the panel in a second, generic gesture:
  // the frames parting and the rows scanning up is the room's own language and there is no reason to
  // speak another one. See lib/hooks/useSectionArrival.ts for the sections that DO need their own.
  const [arrivalReplay, setArrivalReplay] = useState(0);
  useEffect(() => {
    const handleArrive = (event: Event) => {
      if (readSectionArriveKey(event) !== CHAMBER_SECTION_KEY) return;
      setArrivalReplay((previous) => previous + 1);
    };
    window.addEventListener(SECTION_ARRIVE_EVENT, handleArrive);
    return () => window.removeEventListener(SECTION_ARRIVE_EVENT, handleArrive);
  }, []);

  useHologramTracking(panelRef);
  useHologramScrollGuard(scrollRef);
  const { openQuestion, goBack } = useHologramReveal({
    screenRef,
    contentRef,
    isOpen,
    openEntry,
    setOpenEntry,
    arrivalReplay,
  });

  const entry = openEntry === null ? null : FAQ_ENTRIES[openEntry];

  return (
    <div
      ref={panelRef}
      className="holo-panel"
      data-open={isOpen}
      // Sealed, it is a black bar in a dark room with nothing in it — and a screen reader announcing
      // seven questions nobody can see is worse than silence.
      aria-hidden={!isOpen}
    >
      <div className="holo-frame holo-frame-top" aria-hidden="true" />

      <div ref={screenRef} className="holo-screen">
        <div ref={scrollRef} className="holo-scroll">
          <div ref={contentRef} className="holo-content">
            {entry ? (
              <div className="holo-answer">
                <button type="button" className="holo-back holo-stagger" onClick={goBack}>
                  <span className="holo-back-arrow" aria-hidden="true">
                    ←
                  </span>
                  all questions
                </button>
                <p className="holo-answer-index holo-stagger">{entry.index}</p>
                <h3 className="holo-answer-question font-display holo-stagger">
                  {entry.question}
                </h3>
                {entry.answer.map((paragraph) => (
                  <p key={paragraph} className="holo-answer-copy holo-stagger">
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : (
              <div className="holo-list">
                <p className="holo-eyebrow holo-stagger">Frequencies</p>
                <ul className="holo-rows">
                  {FAQ_ENTRIES.map((faq, index) => (
                    <li key={faq.index}>
                      <button
                        type="button"
                        className="holo-row holo-stagger"
                        onClick={() => openQuestion(index)}
                      >
                        <span className="holo-row-index">{faq.index}</span>
                        <span className="holo-row-question">{faq.question}</span>
                        <span className="holo-row-arrow" aria-hidden="true">
                          →
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="holo-frame holo-frame-bottom" aria-hidden="true" />
    </div>
  );
}
