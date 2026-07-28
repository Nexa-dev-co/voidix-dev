import { addFaqEntry, deleteFaqEntry, saveFaqEntry } from '@/app/actions';
import EditorForm from '@/components/EditorForm/EditorForm';
import { fetchFaqEntries } from '@/lib/contentQueries';

export const dynamic = 'force-dynamic';

export default async function FaqPage() {
  const entries = await fetchFaqEntries();

  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="eyebrow mb-3">Draft</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">FAQ</h1>
        <p className="text-sm max-w-xl leading-relaxed" style={{ color: 'var(--muted)' }}>
          The questions the chamber hologram answers. Add as many as you like — the hologram measures
          its own content and the frames move to fit, so length costs nothing here.
        </p>
      </header>

      <section className="panel-card p-6">
        <p className="eyebrow mb-4">{entries.length} questions</p>
        <EditorForm action={addFaqEntry} submitLabel="Add a question" pendingLabel="Adding…">
          <span />
        </EditorForm>
      </section>

      {entries.map((entry, place) => (
        <section key={entry.id} className="panel-card p-6">
          <p className="eyebrow mb-4">{String(place + 1).padStart(2, '0')}</p>

          <EditorForm action={saveFaqEntry} submitLabel="Save draft">
            <input type="hidden" name="id" value={entry.id} />

            <div>
              <label className="field-label" htmlFor={`question-${entry.id}`}>
                Question
              </label>
              <input
                id={`question-${entry.id}`}
                name="question"
                defaultValue={entry.question}
                className="field-input"
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor={`answer-${entry.id}`}>
                Answer
              </label>
              <textarea
                id={`answer-${entry.id}`}
                name="answer"
                defaultValue={entry.answer.join('\n')}
                className="field-textarea"
                style={{ minHeight: '9rem' }}
                required
              />
              <p className="field-hint">
                One paragraph per line. Blank lines are ignored, so you can space them out while writing.
              </p>
            </div>
          </EditorForm>

          <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--border)' }}>
            <EditorForm
              action={deleteFaqEntry}
              submitLabel="Remove this question"
              pendingLabel="Removing…"
              destructive
              hint="Removed from the draft only. The live site keeps its current version until you publish."
            >
              <input type="hidden" name="id" value={entry.id} />
            </EditorForm>
          </div>
        </section>
      ))}
    </div>
  );
}
