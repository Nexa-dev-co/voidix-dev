import { NextResponse } from 'next/server';
import { UTApi } from 'uploadthing/server';
import {
  APPLICATIONS_PATH,
  HONEYPOT_FIELD,
  orUndefined,
  postToPanel,
  withUrlScheme,
} from '@/lib/cms/panelIntake';

/**
 * The careers form, on its way to the panel's applications inbox.
 *
 * ⚠ AN APPLICATION IS NOT A LEAD, and the panel enforces that structurally — `career_applications`
 * has no path to `contacts` at all. A candidate is not a prospect, the two have opposite
 * relationships to the studio, and a CV is far more sensitive than an enquiry. Nothing in this file
 * should ever be "simplified" into sharing the enquiry route.
 *
 * ── ⚠ THE PDF STOPS HERE ────────────────────────────────────────────────────────────────────────
 * The panel takes the CV as a URL and never receives bytes, deliberately: deleting an application
 * then removes our link rather than someone's file, and the panel needs no storage, no multipart
 * handling and no retention policy for binaries. So this route is where the file actually goes —
 * uploaded to UploadThing server-side, with the returned URL sent on as `cvUrl`.
 *
 * Server-side rather than from the browser (`UTApi`, not the upload widget) so the applicant posts
 * once, to one place, and the form stays the plain multipart form it already was. It also keeps
 * `UPLOADTHING_TOKEN` off the client, where it would be a write credential handed to every visitor.
 *
 * ⚠ THE UPLOAD IS CHECKED BEFORE ANYTHING IS FILED. If it fails, the whole submission fails and the
 * applicant is told — the alternative is an application arriving with the CV silently missing,
 * which is worse than not arriving at all, because nobody knows to ask for it.
 */
export const dynamic = 'force-dynamic';

/**
 * ⚠ The form's own ceiling, restated. It is checked there so a 6 MB file is refused before anyone
 * waits for an upload, and again here because the form's check runs in a browser the applicant
 * controls and this route is a public endpoint.
 */
const CV_FILE_MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request) {
  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a form submission.' }, { status: 400 });
  }

  const read = (field: string) => orUndefined(String(form.get(field) ?? ''));

  const workLink = read('workLink');
  const submittedCv = form.get('cvFile');
  const cvFile = submittedCv instanceof File && submittedCv.size > 0 ? submittedCv : null;

  // The either-of rule, server side. The form states it and focuses the field; this is the half
  // that holds when the form is not the thing doing the posting.
  if (!workLink && !cvFile) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'invalid',
        fieldErrors: { workLink: 'We need something to read — a link, a CV, either will do.' },
      },
      { status: 422 },
    );
  }

  if (cvFile && cvFile.size > CV_FILE_MAX_BYTES) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'invalid',
        fieldErrors: { cvFile: 'That file is over the 5 MB limit.' },
      },
      { status: 422 },
    );
  }

  let cvUrl: string | undefined;

  if (cvFile) {
    cvUrl = await uploadCv(cvFile);

    if (!cvUrl) {
      // Reported as unavailable rather than invalid: there is nothing wrong with the applicant's
      // file, so telling them to fix it would send them looking for a fault that is ours.
      return NextResponse.json({ ok: false, reason: 'unavailable' }, { status: 502 });
    }
  }

  const result = await postToPanel(APPLICATIONS_PATH, {
    name: read('name') ?? '',
    email: read('email') ?? '',
    phone: read('phone'),
    whyYou: read('brief') ?? '',
    // The panel requires a scheme and the form deliberately does not — see `withUrlScheme`.
    workLink: workLink ? withUrlScheme(workLink) : undefined,
    cvUrl,
    // ⚠ The SLUG, never the title. The panel matches on it, and a title would break the moment an
    // editor rewrote one. Absent for an open application, and absent for the placeholder roles this
    // repo falls back to — both file as an open application, which is the honest answer for a job
    // that answers to no row.
    roleSlug: read('roleSlug'),
    commitment: read('commitment'),
    [HONEYPOT_FIELD]: read(HONEYPOT_FIELD),
  });

  return NextResponse.json(result, { status: result.ok ? 201 : statusFor(result.reason) });
}

/**
 * Puts the CV somewhere the panel can link to, and returns that link.
 *
 * Returns `undefined` on any failure rather than throwing: the caller has a specific thing to tell
 * the applicant, and an exception here would replace it with a 500.
 */
async function uploadCv(cvFile: File): Promise<string | undefined> {
  if (!process.env.UPLOADTHING_TOKEN) {
    console.warn('[cms] UPLOADTHING_TOKEN is unset — a CV cannot be stored');
    return undefined;
  }

  try {
    // Constructed per request, not at module scope: the token is read at construction, and a
    // module-level instance would capture whatever the environment held at import time.
    const uploadThing = new UTApi();
    const upload = await uploadThing.uploadFiles(cvFile);

    if (upload.error) {
      console.warn(`[cms] the CV upload failed: ${upload.error.message}`);
      return undefined;
    }

    // `ufsUrl`, not the deprecated `url` — the latter is removed in uploadthing v9.
    return upload.data.ufsUrl;
  } catch (error) {
    console.warn(
      `[cms] the CV upload threw: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return undefined;
  }
}

function statusFor(reason: 'invalid' | 'rate-limited' | 'unavailable'): number {
  if (reason === 'invalid') return 422;
  if (reason === 'rate-limited') return 429;
  return 502;
}

export function GET() {
  return NextResponse.json(
    { error: 'This endpoint accepts POST only.' },
    { status: 405, headers: { allow: 'POST' } },
  );
}
