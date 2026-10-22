-- =====================================================================
--  Gastherm Service — βάση δεδομένων (Supabase / PostgreSQL)
--  Εκτέλεση: Supabase → SQL Editor → New query → επικόλληση → Run.
--  Το αρχείο μπορεί να ξανατρέξει με ασφάλεια (π.χ. μετά από ενημέρωση).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Πίνακες
-- ---------------------------------------------------------------------

-- Χρήστες της εφαρμογής (ένα προφίλ για κάθε λογαριασμό Supabase Auth)
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  phone       text,
  role        text not null default 'technician' check (role in ('admin','technician')),
  active      boolean not null default true,
  color       text,
  created_at  timestamptz not null default now()
);

-- Πελάτες
create table if not exists public.customers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text,
  phone2       text,
  email        text,
  address      text,
  city         text,
  postal_code  text,
  vat_number   text,
  notes        text,
  created_by   uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Εγκαταστάσεις (κάθε πελάτης μπορεί να έχει πολλές)
create table if not exists public.installations (
  id                       uuid primary key default gen_random_uuid(),
  customer_id              uuid not null references public.customers(id) on delete cascade,
  title                    text,
  category                 text,
  brand                    text,
  model                    text,
  serial_number            text,
  power_kw                 numeric(8,2),
  install_date             date,
  warranty_until           date,
  service_interval_months  int not null default 12 check (service_interval_months between 1 and 120),
  last_service_date        date,
  next_service_date        date,
  address                  text,
  city                     text,
  lat                      double precision,
  lng                      double precision,
  notes                    text,
  active                   boolean not null default true,
  created_by               uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- Επισκέψεις / ραντεβού (προγραμματισμένες, ολοκληρωμένες, ακυρωμένες)
create table if not exists public.visits (
  id                 uuid primary key default gen_random_uuid(),
  installation_id    uuid not null references public.installations(id) on delete cascade,
  customer_id        uuid references public.customers(id) on delete cascade,
  kind               text not null default 'maintenance'
                     check (kind in ('maintenance','inspection','repair','installation','other')),
  status             text not null default 'scheduled' check (status in ('scheduled','done','cancelled')),
  scheduled_date     date not null,
  scheduled_time     time,
  duration_min       int default 60,
  assigned_to        uuid references public.profiles(id) on delete set null,
  completed_date     date,
  work_done          text,
  notes              text,
  cost               numeric(10,2),
  measurements       jsonb,
  control_sheet      boolean not null default false,
  next_due_date      date,
  reschedule_count   int not null default 0,
  reschedule_log     jsonb not null default '[]'::jsonb,
  reschedule_reason  text,
  created_by         uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists installations_customer_idx on public.installations(customer_id);
create index if not exists visits_installation_idx   on public.visits(installation_id);
create index if not exists visits_date_idx           on public.visits(scheduled_date);
create index if not exists visits_assigned_idx       on public.visits(assigned_to);

-- ---------------------------------------------------------------------
-- 2. Βοηθητικές συναρτήσεις ρόλων
-- ---------------------------------------------------------------------

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

-- ---------------------------------------------------------------------
-- 3. Triggers
-- ---------------------------------------------------------------------

-- updated_at σε κάθε αλλαγή
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists customers_touch on public.customers;
create trigger customers_touch before update on public.customers
  for each row execute function public.touch_updated_at();

drop trigger if exists installations_touch on public.installations;
create trigger installations_touch before update on public.installations
  for each row execute function public.touch_updated_at();

drop trigger if exists visits_touch on public.visits;
create trigger visits_touch before update on public.visits
  for each row execute function public.touch_updated_at();

-- Νέος λογαριασμός → νέο προφίλ. Ο πρώτος λογαριασμός γίνεται διαχειριστής.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1)),
    case when exists (select 1 from public.profiles where role = 'admin') then 'technician' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Προφίλ: ο τεχνικός αλλάζει μόνο όνομα/τηλέφωνο/χρώμα του.
-- Πάντα μένει τουλάχιστον ένας ενεργός διαχειριστής.
create or replace function public.profiles_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    new.role   := old.role;
    new.active := old.active;
    new.email  := old.email;
  end if;
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles
                   where role = 'admin' and active and id <> old.id) then
      raise exception 'Πρέπει να υπάρχει τουλάχιστον ένας ενεργός διαχειριστής.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

-- Εγκατάσταση: αυτόματη επόμενη συντήρηση από την τελευταία (ή την ημερομηνία εγκατάστασης)
create or replace function public.installations_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.next_service_date is null then
      if new.last_service_date is not null then
        new.next_service_date := (new.last_service_date + make_interval(months => new.service_interval_months))::date;
      elsif new.install_date is not null then
        new.next_service_date := (new.install_date + make_interval(months => new.service_interval_months))::date;
      end if;
    end if;
  else
    if (new.last_service_date is distinct from old.last_service_date
        or new.service_interval_months is distinct from old.service_interval_months)
       and new.next_service_date is not distinct from old.next_service_date
       and new.last_service_date is not null then
      new.next_service_date := (new.last_service_date + make_interval(months => new.service_interval_months))::date;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists installations_before on public.installations;
create trigger installations_before before insert or update on public.installations
  for each row execute function public.installations_before();

-- Επίσκεψη (πριν την αποθήκευση): πελάτης από την εγκατάσταση, όρια τεχνικού,
-- ιστορικό μεταθέσεων, ημερομηνία ολοκλήρωσης.
create or replace function public.visits_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.installation_id is distinct from old.installation_id then
    select customer_id into new.customer_id from public.installations where id = new.installation_id;
  end if;

  if tg_op = 'UPDATE' then
    if auth.uid() is not null and not public.is_admin() then
      if new.assigned_to is distinct from old.assigned_to
         or new.installation_id is distinct from old.installation_id then
        raise exception 'Μόνο ο διαχειριστής αλλάζει τεχνικό ή εγκατάσταση σε μια επίσκεψη.';
      end if;
    end if;

    if old.status = 'scheduled' and new.status = 'scheduled'
       and (new.scheduled_date is distinct from old.scheduled_date
            or new.scheduled_time is distinct from old.scheduled_time) then
      new.reschedule_count := old.reschedule_count + 1;
      new.reschedule_log := coalesce(old.reschedule_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'from_date', old.scheduled_date, 'from_time', old.scheduled_time,
        'to_date',   new.scheduled_date, 'to_time',   new.scheduled_time,
        'reason',    new.reschedule_reason,
        'by',        auth.uid(),
        'at',        now()
      ));
    end if;
  end if;

  if new.status = 'done' and new.completed_date is null then
    new.completed_date := least(new.scheduled_date, current_date);
  end if;
  if new.status <> 'done' then
    new.completed_date := null;
  end if;
  return new;
end $$;

drop trigger if exists visits_before on public.visits;
create trigger visits_before before insert or update on public.visits
  for each row execute function public.visits_before();

-- Επίσκεψη (μετά την αποθήκευση): όταν ολοκληρώνεται συντήρηση, μέτρηση ή εγκατάσταση,
-- ενημερώνεται η τελευταία και η επόμενη συντήρηση της εγκατάστασης.
create or replace function public.visits_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done'
     and new.kind in ('maintenance','inspection','installation')
     and (tg_op = 'INSERT'
          or old.status <> 'done'
          or new.completed_date is distinct from old.completed_date
          or new.next_due_date  is distinct from old.next_due_date) then
    update public.installations i
       set last_service_date = new.completed_date,
           next_service_date = coalesce(
             new.next_due_date,
             (new.completed_date + make_interval(months => i.service_interval_months))::date)
     where i.id = new.installation_id
       and (i.last_service_date is null or new.completed_date >= i.last_service_date);
  end if;
  return new;
end $$;

drop trigger if exists visits_after on public.visits;
create trigger visits_after after insert or update on public.visits
  for each row execute function public.visits_after();

-- ---------------------------------------------------------------------
-- 4. Δικαιώματα (Row Level Security)
--    Διαχειριστής: τα πάντα.
--    Τεχνικός: βλέπει τα πάντα, δημιουργεί/ενημερώνει/ολοκληρώνει
--    τις επισκέψεις που του έχουν ανατεθεί.
-- ---------------------------------------------------------------------

alter table public.profiles      enable row level security;
alter table public.customers     enable row level security;
alter table public.installations enable row level security;
alter table public.visits        enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_member() or id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

drop policy if exists customers_select on public.customers;
create policy customers_select on public.customers for select to authenticated using (public.is_member());
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert to authenticated with check (public.is_admin());
drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists customers_delete on public.customers;
create policy customers_delete on public.customers for delete to authenticated using (public.is_admin());

drop policy if exists installations_select on public.installations;
create policy installations_select on public.installations for select to authenticated using (public.is_member());
drop policy if exists installations_insert on public.installations;
create policy installations_insert on public.installations for insert to authenticated with check (public.is_admin());
drop policy if exists installations_update on public.installations;
create policy installations_update on public.installations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists installations_delete on public.installations;
create policy installations_delete on public.installations for delete to authenticated using (public.is_admin());

drop policy if exists visits_select on public.visits;
create policy visits_select on public.visits for select to authenticated using (public.is_member());
drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits for insert to authenticated
  with check (public.is_admin() or (public.is_member() and assigned_to = auth.uid()));
drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits for update to authenticated
  using (public.is_admin() or (public.is_member() and assigned_to = auth.uid()))
  with check (public.is_admin() or (public.is_member() and assigned_to = auth.uid()));
drop policy if exists visits_delete on public.visits;
create policy visits_delete on public.visits for delete to authenticated using (public.is_admin());

grant select, insert, update, delete on public.customers, public.installations, public.visits to authenticated;
grant select, update on public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 5. Ζωντανός συγχρονισμός (Realtime) για όλους τους πίνακες
-- ---------------------------------------------------------------------

do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profiles','customers','installations','visits'] loop
      if not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. Προφίλ για λογαριασμούς που υπήρχαν ήδη πριν τρέξει το αρχείο
-- ---------------------------------------------------------------------

insert into public.profiles (id, email, full_name)
select u.id, u.email, split_part(u.email, '@', 1) from auth.users u
on conflict (id) do nothing;

update public.profiles set role = 'admin'
 where id = (select u.id from auth.users u order by u.created_at limit 1)
   and not exists (select 1 from public.profiles where role = 'admin');
