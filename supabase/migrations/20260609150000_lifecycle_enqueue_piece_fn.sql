-- Phase 0 (YAR-149): atomic enqueue for the publishing lifecycle layer.
--
-- lifecycle_enqueue_piece inserts ONE content_queue row and ONE scheduled_posts
-- row per target channel inside a single transaction (a plpgsql function is
-- atomic). If any row fails — bad channel, UNIQUE(content_id, channel)
-- violation, render_complete_minimum_contract violation — the whole call rolls
-- back and NO content_queue row is left behind (no orphan).
--
-- content_queue is written with render_status='complete', so the
-- render_complete_minimum_contract CHECK requires final_asset_url +
-- render_completed_at, which are supplied here (atomic completion).
--
-- status is caller-controlled: 'pending_approval' (fail-closed default) or
-- 'approved' (a human approved upstream). The web app's approval mechanism is
-- writing content_queue.status='approved' (Pipeline.tsx / ContentDetailPage.tsx).
--
-- p_channels is a JSON array of { channel, caption, scheduled_for }.

create or replace function public.lifecycle_enqueue_piece(
  p_render_profile_slug text,
  p_pillar              text,
  p_hook                text,
  p_caption             text,
  p_final_asset_url     text,
  p_render_completed_at timestamptz,
  p_status              text,
  p_metadata            jsonb,
  p_channels            jsonb
) returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_content_id uuid;
  v_chan       jsonb;
begin
  if p_status not in ('approved', 'pending_approval') then
    raise exception 'lifecycle_enqueue_piece: p_status must be approved|pending_approval, got %', p_status;
  end if;

  select id into v_profile_id from public.render_profiles where slug = p_render_profile_slug;
  if v_profile_id is null then
    raise exception 'lifecycle_enqueue_piece: unknown render_profile_slug %', p_render_profile_slug;
  end if;

  if p_channels is null
     or jsonb_typeof(p_channels) <> 'array'
     or jsonb_array_length(p_channels) = 0 then
    raise exception 'lifecycle_enqueue_piece: p_channels must be a non-empty JSON array';
  end if;

  insert into public.content_queue (
    hook, caption, content_pillar, render_profile_id,
    render_status, final_asset_url, render_completed_at, status, metadata
  ) values (
    p_hook, p_caption, p_pillar, v_profile_id,
    'complete', p_final_asset_url, coalesce(p_render_completed_at, now()),
    p_status::content_status, coalesce(p_metadata, '{}'::jsonb)
  ) returning id into v_content_id;

  for v_chan in select * from jsonb_array_elements(p_channels)
  loop
    insert into public.scheduled_posts (content_id, channel, status, caption, scheduled_for)
    values (
      v_content_id,
      (v_chan->>'channel')::channel,
      'pending',
      v_chan->>'caption',
      nullif(v_chan->>'scheduled_for', '')::timestamptz
    );
  end loop;

  return v_content_id;
end;
$$;

comment on function public.lifecycle_enqueue_piece is
  'Phase 0 lifecycle layer: atomically insert a completed content_queue row + one scheduled_posts row per channel. All-or-nothing; no orphan content rows.';
