-- Fixes: "infinite recursion detected in policy for relation group_members"
--
-- The original "Users can read own group members" policy referenced
-- group_members from within its own USING clause (to let a member see their
-- groupmates' rows, not just their own):
--
--   participant_id in (select id from event_participants where profile_id = auth.uid())
--   or group_id in (select group_id from group_members where participant_id in (...))
--                                     ^^^^^^^^^^^^ same table the policy protects
--
-- Postgres detects that self-reference and refuses to evaluate the policy at
-- all (error 42P17), which made every group_members SELECT fail — including
-- the one on the /chat page's group lookup, so real users always saw
-- "You are not in a group" regardless of their actual membership.
--
-- Fix: move the self-lookup into a SECURITY DEFINER function. Functions
-- owned by the table owner (the default here) bypass RLS on their own
-- queries, so the inner lookup no longer re-triggers the same policy.

create or replace function public.my_group_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select group_id from group_members
  where participant_id in (
    select id from event_participants where profile_id = auth.uid()
  );
$$;

grant execute on function public.my_group_ids() to authenticated;

drop policy if exists "Users can read own group members" on group_members;
create policy "Users can read own group members" on group_members for select using (
  participant_id in (select id from event_participants where profile_id = auth.uid())
  or group_id in (select public.my_group_ids())
);
