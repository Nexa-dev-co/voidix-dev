import { saveService } from '@/app/actions';
import EditorForm from '@/components/EditorForm/EditorForm';
import { fetchServices } from '@/lib/contentQueries';

export const dynamic = 'force-dynamic';

// The vessels available to assign, from apps/web/public/models. Models can't be uploaded through the
// panel: each one needs Draco compression plus hand-tuned rotation and framing against the scene, so
// adding to this list is a developer job. Listed here rather than read from disk because the two apps
// deploy separately and don't share a filesystem.
const VESSEL_MODELS = [
  '/models/spaceship.glb',
  '/models/spaceship2.glb',
  '/models/spaceship3.glb',
  '/models/cargo_spaceship.glb',
  '/models/star_aventure_spaceship_starship_fighter.glb',
  '/models/episode_77_-_spaceship.glb',
  '/models/helicopter_space_ship.glb',
  '/models/wip_weird_sh_ship.glb',
];

export default async function ServicesPage() {
  const services = await fetchServices();

  return (
    <div className="flex flex-col gap-10">
      <header>
        <p className="eyebrow mb-3">Draft</p>
        <h1 className="font-display text-3xl font-extrabold tracking-tight mb-2">Services</h1>
        <p className="text-sm max-w-xl leading-relaxed" style={{ color: 'var(--muted)' }}>
          The four craft on the services deck, in the order visitors scroll through them. Each ship&rsquo;s
          colours, lighting and material are art direction and stay in code for now.
        </p>
      </header>

      {services.map((service, place) => (
        <section key={service.id} className="panel-card p-6">
          <p className="eyebrow mb-4">{String(place + 1).padStart(2, '0')}</p>

          <EditorForm action={saveService} submitLabel="Save draft">
            <input type="hidden" name="id" value={service.id} />

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor={`name-${service.id}`}>
                  Name
                </label>
                <input
                  id={`name-${service.id}`}
                  name="name"
                  defaultValue={service.name}
                  className="field-input"
                  required
                />
              </div>

              <div>
                <label className="field-label" htmlFor={`eyebrow-${service.id}`}>
                  Eyebrow
                </label>
                <input
                  id={`eyebrow-${service.id}`}
                  name="eyebrow"
                  defaultValue={service.eyebrow}
                  className="field-input"
                  required
                />
              </div>
            </div>

            <div>
              <label className="field-label" htmlFor={`description-${service.id}`}>
                Description
              </label>
              <textarea
                id={`description-${service.id}`}
                name="description"
                defaultValue={service.description}
                className="field-textarea"
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor={`capabilities-${service.id}`}>
                  Capabilities
                </label>
                <input
                  id={`capabilities-${service.id}`}
                  name="capabilities"
                  defaultValue={service.capabilities.join(', ')}
                  className="field-input"
                />
                <p className="field-hint">Separate with commas.</p>
              </div>

              <div>
                <label className="field-label" htmlFor={`model-${service.id}`}>
                  Vessel
                </label>
                <select
                  id={`model-${service.id}`}
                  name="model_path"
                  defaultValue={service.model_path}
                  className="field-input"
                >
                  {/* A model already assigned but no longer in the list would otherwise vanish
                      silently and be replaced on save. */}
                  {!VESSEL_MODELS.includes(service.model_path) ? (
                    <option value={service.model_path}>{service.model_path} (unlisted)</option>
                  ) : null}
                  {VESSEL_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {model.replace('/models/', '').replace('.glb', '')}
                    </option>
                  ))}
                </select>
                <p className="field-hint">Give each service its own hull — no two should share one.</p>
              </div>
            </div>
          </EditorForm>
        </section>
      ))}
    </div>
  );
}
