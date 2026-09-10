import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { checkDashApiAccess } from '@/lib/portal/api-gate';
import { resolveSessionId } from '@/lib/portal/demo';
import { isLeadSnapshotLive } from '@/lib/leads/capability';
import {
  checkImage,
  imageRejectionMessage,
  storagePathFor,
  MAX_IMAGES_PER_REQUEST,
} from '@/lib/leads/snapshotImage';
import { parseSnapshotReply } from '@/lib/leads/snapshotParse';
import { snapshotPrompt } from '@/lib/leads/snapshotPrompt';
import { visionComplete, type VisionImage } from '@/lib/demo/portkey';

// POST /api/dash/<sessionId>/snapshot
//
// Lead Snapshot phase A: take 1..N photos, return the lead candidates a human
// then confirms. This endpoint NEVER sends anything. Nothing here texts a lead,
// creates a client_leads row, or touches the pipeline. All of that happens at
// the confirm step, behind the consent attestation, in phase B.
//
// Spec: amos repo, projects/deployed/mate-onboarding/lead-snapshot-spec.md

export const dynamic = 'force-dynamic';
// Vision on up to five images does not fit in a default serverless budget.
export const maxDuration = 60;

/** Per session per hour. A stuck retry loop must not become a bill, and in
 *  phase B it must not become an SMS blast. */
const MAX_SNAPSHOTS_PER_HOUR = 20;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId: rawSessionId } = await params;
  const sessionId = resolveSessionId(rawSessionId);

  const verdict = await checkDashApiAccess(sessionId);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  }

  const service = createServiceClient();

  const { data: session, error: sessionError } = await service
    .from('onboarding_sessions')
    .select('id, is_demo, contact_id')
    .eq('id', sessionId)
    .maybeSingle();

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });
  if (!session) return NextResponse.json({ error: 'session not found' }, { status: 404 });

  // An is_demo session renders without authentication, so anything written to
  // it is world readable to anyone holding the URL. /api/leads/ingest refuses
  // this by name after real names and phone numbers sat on an unauthed page
  // for three months. There is no allow_demo escape here on purpose: seeding a
  // demo from a photograph of a real person is never legitimate.
  if (session.is_demo) {
    return NextResponse.json(
      { error: 'Lead Snapshot is not available on the demo dashboard.' },
      { status: 400 },
    );
  }

  // Capability gate. client_capabilities is anchored on contact_id, not
  // session_id (migration 016), and the session row carries contact_id from
  // onboarding completion. No contact_id means no capability rows, so no.
  if (!session.contact_id) {
    return NextResponse.json({ error: 'Lead Snapshot is not enabled for this account.' }, { status: 403 });
  }
  const { data: caps } = await service
    .from('client_capabilities')
    .select('capability_key, status')
    .eq('contact_id', session.contact_id as string);

  if (!isLeadSnapshotLive(caps)) {
    return NextResponse.json({ error: 'Lead Snapshot is not enabled for this account.' }, { status: 403 });
  }

  // Rate limit off the snapshot table itself rather than a separate counter:
  // one indexed range scan on the index migration 0017 already adds.
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await service
    .from('lead_snapshots')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .gte('created_at', hourAgo);

  if ((recentCount ?? 0) >= MAX_SNAPSHOTS_PER_HOUR) {
    return NextResponse.json(
      { error: 'Too many uploads in the last hour. Try again shortly.' },
      { status: 429 },
    );
  }

  // ---- read the upload -----------------------------------------------------

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Expected a multipart upload.' }, { status: 400 });
  }

  const files = form.getAll('images').filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: 'No photo was attached.' }, { status: 400 });
  }
  if (files.length > MAX_IMAGES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Up to ${MAX_IMAGES_PER_REQUEST} photos at a time.` },
      { status: 400 },
    );
  }

  // Sniff every file BEFORE anything is stored or sent upstream. The declared
  // content-type is the client's claim, not evidence.
  const prepared: { bytes: Uint8Array; mime: string; ext: string }[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const check = checkImage(bytes);
    if (!check.ok) {
      return NextResponse.json({ error: imageRejectionMessage(check.rejection) }, { status: 400 });
    }
    prepared.push({ bytes, mime: check.mime, ext: check.ext });
  }

  // Who is uploading, for the consent record. The gate already proved they may.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // ---- create the row, then store the evidence -----------------------------

  const { data: snapshot, error: insertError } = await service
    .from('lead_snapshots')
    .insert({
      session_id: sessionId,
      uploaded_by: user?.id ?? null,
      // Set below once the snapshot id exists, which is what the path is keyed
      // on. A placeholder keeps the NOT NULL contract without inventing a path.
      storage_path: 'pending',
      status: 'extracting',
    })
    .select('id')
    .single();

  if (insertError || !snapshot) {
    return NextResponse.json({ error: insertError?.message ?? 'could not start upload' }, { status: 500 });
  }

  const snapshotId = snapshot.id as string;
  const paths: string[] = [];

  for (let i = 0; i < prepared.length; i += 1) {
    const p = prepared[i];
    const path = storagePathFor(sessionId, snapshotId, i, p.ext);
    const { error: uploadError } = await service.storage
      .from('lead-snapshots')
      .upload(path, p.bytes, { contentType: p.mime, upsert: true });

    if (uploadError) {
      await service
        .from('lead_snapshots')
        .update({ status: 'failed', error: `storage: ${uploadError.message}` })
        .eq('id', snapshotId);
      return NextResponse.json({ error: 'Could not save that photo. Try again.' }, { status: 500 });
    }
    paths.push(path);
  }

  await service.from('lead_snapshots').update({ storage_path: paths.join(',') }).eq('id', snapshotId);

  // ---- extract -------------------------------------------------------------

  const { system, prompt } = snapshotPrompt();
  const images: VisionImage[] = prepared.map(p => ({ mime: p.mime, bytes: p.bytes }));

  const vision = await visionComplete({
    prompt,
    system,
    images,
    clientId: (session.contact_id as string) ?? undefined,
  });

  if (!vision.ok) {
    await service
      .from('lead_snapshots')
      .update({ status: 'failed', error: `${vision.kind}: ${vision.detail}` })
      .eq('id', snapshotId);

    // Say which kind of problem it was, because the two need different actions
    // from the person holding the phone. A gateway or quota failure is ours to
    // fix and retrying in a second will not help; an empty read is theirs.
    const message =
      vision.kind === 'network' || vision.kind === 'http'
        ? 'The reader is unavailable right now. Your photo was saved, try again in a few minutes.'
        : 'Could not read that photo. Try again with more light, or type the lead in by hand.';
    return NextResponse.json({ snapshot_id: snapshotId, error: message }, { status: 502 });
  }

  const parsed = parseSnapshotReply(vision.text);

  if (!parsed.ok) {
    await service
      .from('lead_snapshots')
      .update({ status: 'failed', error: `parse: ${parsed.reason}`, extracted: { raw: vision.text } })
      .eq('id', snapshotId);
    return NextResponse.json(
      { snapshot_id: snapshotId, error: 'Could not read that photo. Try again with more light.' },
      { status: 502 },
    );
  }

  await service
    .from('lead_snapshots')
    .update({
      status: 'ready',
      extracted: { candidates: parsed.candidates, unreadable: parsed.unreadable },
    })
    .eq('id', snapshotId);

  return NextResponse.json({
    snapshot_id: snapshotId,
    candidates: parsed.candidates,
    unreadable: parsed.unreadable,
  });
}
