import { MAX_WORKS_PROJECTS } from '@voidix/content';

import { addProject, deleteProject, saveProject } from '@/app/actions';
import EditorForm from '@/components/EditorForm/EditorForm';
import { fetchProjects } from '@/lib/contentQueries';

export const dynamic = 'force-dynamic';

export default async function ProjectsPage() {
  const projects = await fetchProjects();
  const atLimit = projects.length >= MAX_WORKS_PROJECTS;

  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="eyebrow mb-3">Draft</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Work</h1>
        <p className="text-sm max-w-xl leading-relaxed" style={{ color: 'var(--muted)' }}>
          The projects the camera visits in the works field. A project is a camera pose around one
          meteor, not a place of its own — which is why there&rsquo;s a hard ceiling on how many there
          can be.
        </p>
      </header>

      <section className="panel-card p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
          <p className="eyebrow">
            {projects.length} of {MAX_WORKS_PROJECTS} camera stops used
          </p>
          {atLimit ? (
            <p className="text-xs" style={{ color: 'var(--danger)' }}>
              All authored stops are taken
            </p>
          ) : null}
        </div>

        <EditorForm
          action={addProject}
          submitLabel="Add a project"
          pendingLabel="Adding…"
          disabled={atLimit}
          hint={
            atLimit
              ? `The works field has ${MAX_WORKS_PROJECTS} hand-authored camera stops. A fifth project would ` +
                'get a scroll position with no pose to fly to, so the section would break at the end of ' +
                'the scroll. Raising the ceiling means recording a new camera stop in the scene — a ' +
                'developer job, not a settings change.'
              : undefined
          }
        >
          <span />
        </EditorForm>
      </section>

      {projects.map((project, place) => (
        <section key={project.id} className="panel-card p-6">
          <p className="eyebrow mb-4">{String(place + 1).padStart(2, '0')}</p>

          <EditorForm action={saveProject} submitLabel="Save draft">
            <input type="hidden" name="id" value={project.id} />

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-1">
                <label className="field-label" htmlFor={`title-${project.id}`}>
                  Title
                </label>
                <input
                  id={`title-${project.id}`}
                  name="title"
                  defaultValue={project.title}
                  className="field-input"
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor={`client-${project.id}`}>
                  Client
                </label>
                <input
                  id={`client-${project.id}`}
                  name="client"
                  defaultValue={project.client}
                  className="field-input"
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor={`year-${project.id}`}>
                  Year
                </label>
                <input
                  id={`year-${project.id}`}
                  name="year"
                  defaultValue={project.year}
                  className="field-input"
                  pattern="\d{4}"
                  required
                />
                <p className="field-hint">Four digits.</p>
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor={`description-${project.id}`}>
                Description
              </label>
              <textarea
                id={`description-${project.id}`}
                name="description"
                defaultValue={project.description}
                className="field-textarea"
                required
              />
            </div>

            <div>
              <label className="field-label" htmlFor={`tags-${project.id}`}>
                Tags
              </label>
              <input
                id={`tags-${project.id}`}
                name="tags"
                defaultValue={project.tags.join(', ')}
                className="field-input"
              />
              <p className="field-hint">Separate with commas.</p>
            </div>
          </EditorForm>

          <div className="mt-6 pt-5 border-t" style={{ borderColor: 'var(--border)' }}>
            <EditorForm
              action={deleteProject}
              submitLabel="Remove this project"
              pendingLabel="Removing…"
              destructive
              hint="Removed from the draft only. The live site keeps its current version until you publish."
            >
              <input type="hidden" name="id" value={project.id} />
            </EditorForm>
          </div>
        </section>
      ))}
    </div>
  );
}
