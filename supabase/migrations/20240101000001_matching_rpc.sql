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
