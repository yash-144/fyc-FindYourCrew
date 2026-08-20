-- `persist_matching_results` assigns group codes (CREW-001, CREW-002, ...)
-- sequentially per matching run, with no awareness of codes already
-- persisted for the event. Re-running matching on an event that was matched
-- before (a replayed test event, or an admin re-clicking "Start Matching")
-- collides with `groups`' unique(event_id, code) constraint and the insert
-- throws, aborting the whole matching workflow with an opaque error.
--
-- Matching should be idempotent per event: each "Start Matching" click is
-- meant to reflect the latest run, so clear out any previous run's groups
-- (group_members/chat_messages/chat_reports cascade away with them) before
-- persisting the new one.
create or replace function persist_matching_results(
  p_event_id uuid,
  p_groups jsonb,
  p_audit jsonb
) returns void language plpgsql security definer as $$
declare
  grp record;
  new_group_id uuid;
  member_id uuid;
begin
  -- Clear any groups from a previous matching run on this event.
  delete from public.groups where event_id = p_event_id;

  -- 1. Insert the groups
  for grp in select * from jsonb_to_recordset(p_groups) as x(code text, name text, icebreaker_prompt text, member_participant_ids jsonb) loop
    insert into public.groups (event_id, code, name, icebreaker_prompt, matching_audit)
    values (p_event_id, grp.code, grp.name, grp.icebreaker_prompt, p_audit)
    returning id into new_group_id;

    -- 2. Insert the group members
    for member_id in select jsonb_array_elements_text(grp.member_participant_ids)::uuid loop
      insert into public.group_members (group_id, participant_id)
      values (new_group_id, member_id);
    end loop;
  end loop;
end;
$$;
