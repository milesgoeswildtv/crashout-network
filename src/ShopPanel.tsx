import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Backpack, Coins, RefreshCw, ShoppingBag } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib';

type GameKey='shyst'|'poker'|'realms'|'rituals'|'degen'|'mmo';
type Product={id:string;game_key:GameKey;sku:string;name:string;description:string;currency_code:string;price:number;item_type:string;item_key:string;stock_remaining:number|null;per_user_limit:number|null};
type Owned={id:string;game_key:GameKey;item_key:string;item_type:string;quantity:number;acquired_at:string};
type Wallet={game_key:GameKey;currency_code:string;balance:number};
type Receipt={id:string;game_key:GameKey;currency_code:string;quantity:number;unit_price:number;total_price:number;created_at:string};
const games:GameKey[]=['shyst','poker','realms','rituals','degen','mmo'];
const labels:Record<GameKey,string>={shyst:'SHYST',poker:'CRASHOUT POKER',realms:'REALMS',rituals:'RITUALS',degen:'DEGEN',mmo:'MMO'};
export default function ShopPanel({session}:{session:Session|null}){
 const [products,setProducts]=useState<Product[]>([]);
 const [wallets,setWallets]=useState<Wallet[]>([]);
 const [inventory,setInventory]=useState<Owned[]>([]);
 const [receipts,setReceipts]=useState<Receipt[]>([]);
 const [game,setGame]=useState<GameKey>('shyst');
 const [quantity,setQuantity]=useState<Record<string,number>>({});
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const load=useCallback(async()=>{
  if(!supabase){setError('Shop services are not connected. Configure Supabase and apply the database migrations.');return;}
  setBusy(true);setError('');
  try{
   const catalog=await supabase.from('shop_products').select('id,game_key,sku,name,description,currency_code,price,item_type,item_key,stock_remaining,per_user_limit').eq('active',true).order('name');
   if(catalog.error)throw catalog.error;
   setProducts((catalog.data||[]) as Product[]);
   if(session){
    const [w,i,p]=await Promise.all([
     supabase.from('game_wallets').select('game_key,currency_code,balance').eq('user_id',session.user.id),
     supabase.from('player_inventory').select('id,game_key,item_key,item_type,quantity,acquired_at').eq('user_id',session.user.id).order('acquired_at',{ascending:false}),
     supabase.from('shop_purchases').select('id,game_key,currency_code,quantity,unit_price,total_price,created_at').eq('user_id',session.user.id).order('created_at',{ascending:false}).limit(10)
    ]);
    if(w.error)throw w.error;if(i.error)throw i.error;if(p.error)throw p.error;
    setWallets((w.data||[]) as Wallet[]);setInventory((i.data||[]) as Owned[]);setReceipts((p.data||[]) as Receipt[]);
   }else{setWallets([]);setInventory([]);setReceipts([]);}
  }catch(e){setError(e instanceof Error?e.message:'Could not load the shop.');}
  finally{setBusy(false);}
 },[session]);
 useEffect(()=>{void load()},[load]);
 async function buy(product:Product){
  if(!supabase||!session){setError('Sign in before purchasing.');return;}
  const count=quantity[product.id]||1;
  if(!window.confirm('Purchase '+count+' × '+product.name+' for '+(product.price*count).toLocaleString()+' '+product.currency_code+'?'))return;
  setBusy(true);setError('');setMessage('');
  try{
   const {error}=await supabase.rpc('purchase_shop_product',{p_product_id:product.id,p_quantity:count});
   if(error)throw error;
   setMessage('PURCHASE COMPLETE. Your item has been added to '+labels[product.game_key]+' inventory.');
   await load();
  }catch(e){setError(e instanceof Error?e.message:'Purchase failed.');}
  finally{setBusy(false);}
 }
 const shown=products.filter(p=>p.game_key===game);
 const gameWallets=wallets.filter(w=>w.game_key===game);
 const owned=inventory.filter(i=>i.game_key===game);
 return <section className="social-page shop-page">
  <div className="eyebrow">NETWORK / PLAYER MARKET</div><h1>THE <em>SHOP.</em></h1>
  <p className="social-lead">Each destination keeps its own currency, purchases, and inventory. Nothing transfers between games.</p>
  {error&&<div className="auth-error">{error}</div>}{message&&<div className="auth-message">{message}</div>}
  <div className="shop-toolbar"><label>DESTINATION<select value={game} onChange={e=>setGame(e.target.value as GameKey)}>{games.map(g=><option key={g} value={g}>{labels[g]}</option>)}</select></label><button className="social-muted" onClick={()=>void load()} disabled={busy}><RefreshCw size={14}/> REFRESH</button></div>
  {session?<div className="wallet-strip"><div><Coins size={17}/><span>YOUR {labels[game]} WALLETS</span></div>{gameWallets.length?gameWallets.map(w=><b key={w.currency_code}>{w.balance.toLocaleString()} <small>{w.currency_code}</small></b>):<span className="shop-muted">No wallet provisioned for this destination yet.</span>}</div>:<div className="shop-callout">SIGN IN TO VIEW YOUR GAME WALLETS, INVENTORY, AND PURCHASE HISTORY.</div>}
  <div className="shop-section-head"><div><span>AVAILABLE CATALOG</span><b>{labels[game]}</b></div><small>{shown.length} LISTED</small></div>
  {shown.length?<div className="shop-grid">{shown.map(p=><article className="shop-product" key={p.id}><div className="shop-product-type">{p.item_type.toUpperCase()} / {p.sku}</div><h2>{p.name}</h2><p>{p.description||'No description supplied.'}</p><div className="shop-product-price">{p.price.toLocaleString()} <small>{p.currency_code}</small></div>{p.stock_remaining!==null&&<small className="shop-muted">{p.stock_remaining} REMAINING</small>}{p.per_user_limit!==null&&<small className="shop-muted">LIMIT {p.per_user_limit} PER PLAYER</small>}<div className="shop-buy-row"><input aria-label={'Quantity for '+p.name} type="number" min="1" max="99" step="1" value={quantity[p.id]||1} onChange={e=>setQuantity(v=>({...v,[p.id]:Math.max(1,Math.min(99,Math.floor(Number(e.target.value)||1)))}))}/><button className="social-action" disabled={busy||!session||p.stock_remaining===0} onClick={()=>void buy(p)}><ShoppingBag size={14}/> BUY</button></div></article>)}</div>:<div className="empty-state">NO ITEMS ARE LISTED FOR {labels[game]}. THE CATALOG WILL POPULATE WHEN PRODUCTS ARE APPROVED.</div>}
  <div className="shop-lower-grid"><section><div className="shop-section-head"><div><span><Backpack size={13}/> PLAYER INVENTORY</span><b>{labels[game]}</b></div><small>{owned.length} STACKS</small></div>{owned.length?<div className="shop-owned">{owned.map(i=><div key={i.id}><b>{i.item_key}</b><span>{i.item_type.toUpperCase()}</span><strong>×{i.quantity}</strong></div>)}</div>:<div className="empty-state">NO ITEMS OWNED IN THIS DESTINATION.</div>}</section><section><div className="shop-section-head"><div><span>PURCHASE HISTORY</span><b>RECENT RECEIPTS</b></div><small>LAST 10</small></div>{receipts.filter(r=>r.game_key===game).length?<div className="shop-owned">{receipts.filter(r=>r.game_key===game).map(r=><div key={r.id}><b>{r.quantity} ITEM{r.quantity===1?'':'S'}</b><span>{new Date(r.created_at).toLocaleDateString()}</span><strong>−{r.total_price.toLocaleString()} {r.currency_code}</strong></div>)}</div>:<div className="empty-state">NO PURCHASES IN THIS DESTINATION.</div>}</section></div>
  <div className="shop-footnote"><ArrowUpRight size={13}/> Purchases are atomic and recorded in the selected game's ledger. A wallet must be provisioned by a trusted backend before purchases can occur.</div>
 </section>;
}
