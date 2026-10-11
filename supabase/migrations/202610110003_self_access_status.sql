-- EXP Admin: self-only staff access status for the sign-in gate.
-- This reports only the current authenticated user's access status.
-- It does not authorize operational data access or permit profile mutation.

begin;

create or replace function public.get_my_staff_access()
returns table (
  user_id uuid,
  email text,
  display_name text,
  role public.staff_role,
  is_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.email, p.display_name, p.role, p.is_active
  from public.staff_profiles as p
  where p.user_id = (select auth.uid())
  limit 1;
$$;

revoke all on function public.get_my_staff_access() from public, anon;
grant execute on function public.get_my_staff_access() to authenticated;

commit;
