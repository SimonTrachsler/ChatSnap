-- Erlaubt authentifizierten Usern, alle Profile zu lesen (z. B. für Empfänger-Dropdown beim Snap).
-- Es werden nur id und username exponiert.
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);
