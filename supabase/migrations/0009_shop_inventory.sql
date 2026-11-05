-- Separate per-game shop catalogs, wallets, purchases, and owned inventory.
-- No client-side balance, purchase, stock, or inventory writes are permitted.

create table public.shop_products (
  id uuid primary key default gen_random_uuid(),
  game_key public.game_key not null references public.games(key),
  sku text not null check (sku ~ '^[A-Z0-9][A-Z0-9_-]{1,47}$'),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 500),
  currency_code text not null check (currency_code ~ '^[A-Z0-9_]{2,16}$'),
  price bigint not null check (price > 0),
  item_type text not null check (item_type in ('cosmetic','consumable','unlock','bundle','other')),
  item_key text not null check (char_length(trim(item_key)) between 1 and 80),
  item_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(item_metadata)='object'),
  stock_remaining bigint check (stock_remaining is null or stock_remaining >= 0),
  per_user_limit integer check (per_user_limit is null or per_user_limit > 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(game_key,sku)
);
create index shop_products_catalog_idx on public.shop_products(game_key,active,name);

create table public.player_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  game_key public.game_key not null references public.games(key),
  product_id uuid not null references public.shop_products(id),
  item_key text not null,
  item_type text not null,
  quantity bigint not null default 0 check(quantity > 0),
  item_metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(item_metadata)='object'),
  acquired_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,product_id)
);
create index player_inventory_owner_idx on public.player_inventory(user_id,game_key,acquired_at desc);

create table public.shop_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.shop_products(id),
  game_key public.game_key not null references public.games(key),
  currency_code text not null,
  quantity integer not null check(quantity between 1 and 99),
  unit_price bigint not null check(unit_price > 0),
  total_price bigint not null check(total_price > 0),
  created_at timestamptz not null default now()
);
create index shop_purchases_owner_idx on public.shop_purchases(user_id,created_at desc);
create index shop_purchases_product_owner_idx on public.shop_purchases(product_id,user_id);

alter table public.shop_products enable row level security;
alter table public.player_inventory enable row level security;
alter table public.shop_purchases enable row level security;
create policy "active shop catalog is public" on public.shop_products
  for select to anon,authenticated using(active=true);
create policy "inventory owner reads own items" on public.player_inventory
  for select to authenticated using(user_id=auth.uid());
create policy "purchase owner reads own receipts" on public.shop_purchases
  for select to authenticated using(user_id=auth.uid());
revoke insert,update,delete on public.shop_products from anon,authenticated;
revoke all on public.player_inventory from anon,authenticated;
grant select on public.player_inventory to authenticated;
revoke all on public.shop_purchases from anon,authenticated;
grant select on public.shop_purchases to authenticated;

create or replace function public.purchase_shop_product(product_id uuid, purchase_quantity integer default 1)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  buyer uuid := auth.uid();
  product_row public.shop_products%rowtype;
  wallet_row public.game_wallets%rowtype;
  previous_quantity bigint;
  new_purchase uuid;
  total numeric;
begin
  if buyer is null then raise exception 'Sign in before purchasing'; end if;
  if purchase_quantity is null or purchase_quantity < 1 or purchase_quantity > 99 then
    raise exception 'Quantity must be between 1 and 99';
  end if;
  select * into product_row from public.shop_products p
    where p.id=product_id and p.active=true for update;
  if not found then raise exception 'This item is not available'; end if;
  if product_row.stock_remaining is not null and product_row.stock_remaining < purchase_quantity then
    raise exception 'Not enough stock remains';
  end if;
  total := product_row.price::numeric * purchase_quantity;
  if total > 9223372036854775807 then raise exception 'Purchase total is too large'; end if;
  select coalesce(sum(quantity),0) into previous_quantity from public.shop_purchases
    where user_id=buyer and shop_purchases.product_id=purchase_shop_product.product_id;
  if product_row.per_user_limit is not null and previous_quantity + purchase_quantity > product_row.per_user_limit then
    raise exception 'This purchase would exceed the per-player limit';
  end if;
  select * into wallet_row from public.game_wallets
    where user_id=buyer and game_key=product_row.game_key
      and currency_code=product_row.currency_code for update;
  if not found then raise exception 'No wallet exists for this game and currency yet'; end if;
  if wallet_row.balance < total then raise exception 'Insufficient funds'; end if;

  update public.game_wallets set balance=balance-total::bigint
    where id=wallet_row.id;
  insert into public.shop_purchases(user_id,product_id,game_key,currency_code,quantity,unit_price,total_price)
    values(buyer,product_row.id,product_row.game_key,product_row.currency_code,purchase_quantity,product_row.price,total::bigint)
    returning id into new_purchase;
  insert into public.wallet_ledger(wallet_id,delta,reason,idempotency_key)
    values(wallet_row.id,-(total::bigint),'shop_purchase','shop:'||new_purchase::text);
  insert into public.player_inventory(user_id,game_key,product_id,item_key,item_type,quantity,item_metadata)
    values(buyer,product_row.game_key,product_row.id,product_row.item_key,product_row.item_type,purchase_quantity,product_row.item_metadata)
    on conflict(user_id,product_id) do update
      set quantity=public.player_inventory.quantity+excluded.quantity,updated_at=now();
  if product_row.stock_remaining is not null then
    update public.shop_products set stock_remaining=stock_remaining-purchase_quantity,updated_at=now()
      where id=product_row.id;
  end if;
  insert into public.audit_log(actor,action,target_type,target_id,metadata)
    values(buyer,'shop.purchase_completed','shop_purchase',new_purchase::text,
      jsonb_build_object('game_key',product_row.game_key,'sku',product_row.sku,
        'currency_code',product_row.currency_code,'quantity',purchase_quantity,'total',total));
  return jsonb_build_object('purchase_id',new_purchase,'game_key',product_row.game_key,
    'currency_code',product_row.currency_code,'quantity',purchase_quantity,'total_price',total);
end;
$$;

create or replace function public.admin_save_shop_product(
  product_id uuid,
  game public.game_key,
  product_sku text,
  product_name text,
  product_description text,
  product_currency text,
  product_price bigint,
  product_item_type text,
  product_item_key text,
  product_metadata jsonb default '{}'::jsonb,
  product_stock bigint default null,
  product_limit integer default null,
  product_active boolean default false
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare saved_id uuid;
begin
  if auth.uid() is null or not public.is_admin() then raise exception 'Administrator access required'; end if;
  if game is null or product_sku is null or product_sku !~ '^[A-Z0-9][A-Z0-9_-]{1,47}$'
    or product_name is null or char_length(trim(product_name)) not between 1 and 80
    or product_currency is null or product_currency !~ '^[A-Z0-9_]{2,16}$'
    or product_price is null or product_price<=0
    or product_item_type not in ('cosmetic','consumable','unlock','bundle','other')
    or product_item_key is null or char_length(trim(product_item_key)) not between 1 and 80
    or (product_stock is not null and product_stock<0)
    or (product_limit is not null and product_limit<1)
    or jsonb_typeof(coalesce(product_metadata,'{}'::jsonb))<>'object'
  then raise exception 'Invalid shop product details'; end if;
  if product_id is null then
    insert into public.shop_products(game_key,sku,name,description,currency_code,price,item_type,item_key,item_metadata,stock_remaining,per_user_limit,active)
    values(game,product_sku,trim(product_name),coalesce(product_description,''),product_currency,product_price,product_item_type,trim(product_item_key),coalesce(product_metadata,'{}'::jsonb),product_stock,product_limit,coalesce(product_active,false))
    returning id into saved_id;
  else
    update public.shop_products set game_key=game,sku=product_sku,name=trim(product_name),
      description=coalesce(product_description,''),currency_code=product_currency,price=product_price,
      item_type=product_item_type,item_key=trim(product_item_key),item_metadata=coalesce(product_metadata,'{}'::jsonb),
      stock_remaining=product_stock,per_user_limit=product_limit,active=coalesce(product_active,false),updated_at=now()
      where id=product_id returning id into saved_id;
    if saved_id is null then raise exception 'Shop product not found'; end if;
  end if;
  insert into public.audit_log(actor,action,target_type,target_id,metadata)
    values(auth.uid(),'admin.shop_product_saved','shop_product',saved_id::text,
      jsonb_build_object('game_key',game,'sku',product_sku,'active',coalesce(product_active,false)));
  return saved_id;
end;
$$;

revoke all on function public.purchase_shop_product(uuid,integer) from public,anon;
revoke all on function public.admin_save_shop_product(uuid,public.game_key,text,text,text,text,bigint,text,text,jsonb,bigint,integer,boolean) from public,anon;
grant execute on function public.purchase_shop_product(uuid,integer) to authenticated;
grant execute on function public.admin_save_shop_product(uuid,public.game_key,text,text,text,text,bigint,text,text,jsonb,bigint,integer,boolean) to authenticated;
