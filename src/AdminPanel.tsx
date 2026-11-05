import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Search, Shield, Users, Bell, Gamepad2, RefreshCw, ShoppingBag } from 'lucide-react';
import { supabase } from './lib';

type Role='player'|'moderator'|'admin'|'superadmin';
type AdminPlayer={player_id:string;username:string;display_name:string;role:Role;created_at:string};
type Overview={players:number;pending_friend_requests:number;unread_notifications:number;games:{key:string;display_name:string;status:string}[];recent_audit:{id:number;actor:string|null;action:string;target_type:string|null;target_id:string|null;created_at:string}[]};
type ShopProduct={id:string;game_key:'shyst'|'poker'|'realms'|'rituals'|'degen'|'mmo';sku:string;name:string;description:string;currency_code:string;price:number;item_type:string;item_key:string;item_metadata:Record<string,unknown>;stock_remaining:number|null;per_user_limit:number|null;active:boolean};
type Report={id:string;category:string;details:string;status:string;moderator_note:string;created_at:string;reporter_player_id:string;reporter_username:string;target_player_id:string;target_username:string};
export default function AdminPanel({role}:{role:Role}) {
 const [overview,setOverview]=useState<Overview|null>(null);
 const [players,setPlayers]=useState<AdminPlayer[]>([]);
 const [term,setTerm]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [reports,setReports]=useState<Report[]>([]);
 const [reportFilter,setReportFilter]=useState('open');
 const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({});
 const [shopProducts,setShopProducts]=useState<ShopProduct[]>([]);
 const [shopForm,setShopForm]=useState({game:'shyst',sku:'',name:'',description:'',currency:'',price:'',itemType:'cosmetic',itemKey:'',stock:'',limit:'',active:false});
 async function load(){
  if(!supabase)return;setBusy(true);setError('');
  try{const {data,error}=await supabase.rpc('admin_network_overview');if(error)throw error;setOverview(data as Overview);}
  catch(e){setError(e instanceof Error?e.message:'Could not load admin overview.');}
  finally{setBusy(false);}
 }
 async function loadReports(filter=reportFilter){
  if(!supabase)return;setBusy(true);setError('');
  try{const {data,error}=await supabase.rpc('admin_list_player_reports',{report_status:filter});if(error)throw error;setReports((data||[]) as Report[]);}
  catch(e){setError(e instanceof Error?e.message:'Could not load moderation queue.');}
  finally{setBusy(false);}
 }
 async function loadShopProducts(){
  if(!supabase)return;
  const {data,error}=await supabase.rpc('admin_list_shop_products');
  if(error){setError(error.message);return;}
  setShopProducts((data||[]) as ShopProduct[]);
 }
 async function saveShopProduct(e:FormEvent){
  e.preventDefault();if(!supabase)return;
  setBusy(true);setError('');setMessage('');
  try{
   const {error}=await supabase.rpc('admin_save_shop_product',{
    product_id:null,game:shopForm.game,product_sku:shopForm.sku.trim().toUpperCase(),
    product_name:shopForm.name.trim(),product_description:shopForm.description,
    product_currency:shopForm.currency.trim().toUpperCase(),product_price:Number(shopForm.price),
    product_item_type:shopForm.itemType,product_item_key:shopForm.itemKey.trim(),
    product_metadata:{},product_stock:shopForm.stock===''?null:Number(shopForm.stock),
    product_limit:shopForm.limit===''?null:Number(shopForm.limit),product_active:shopForm.active
   });
   if(error)throw error;
   setMessage('Shop product saved.');
   setShopForm(v=>({...v,sku:'',name:'',description:'',price:'',itemKey:'',stock:'',limit:''}));
   await loadShopProducts();
  }catch(e){setError(e instanceof Error?e.message:'Could not save shop product.');}
  finally{setBusy(false);}
 }
 async function toggleShopProduct(p:ShopProduct){
  if(!supabase)return;
  if(!window.confirm((p.active?'Deactivate ':'Publish ')+p.name+'?'))return;
  setBusy(true);setError('');
  try{
   const {error}=await supabase.rpc('admin_save_shop_product',{
    product_id:p.id,game:p.game_key,product_sku:p.sku,product_name:p.name,
    product_description:p.description,product_currency:p.currency_code,product_price:p.price,
    product_item_type:p.item_type,product_item_key:p.item_key,product_metadata:p.item_metadata,
    product_stock:p.stock_remaining,product_limit:p.per_user_limit,product_active:!p.active
   });
   if(error)throw error;
   setMessage('Catalog visibility updated.');
   await loadShopProducts();
  }catch(e){setError(e instanceof Error?e.message:'Could not update product.');}
  finally{setBusy(false);}
 }
 async function reviewReport(report:Report,decision:'reviewing'|'resolved'|'dismissed'){
  if(!supabase)return;
  const note=reviewNotes[report.id]||'';
  if(!window.confirm(decision==='reviewing'?'Assign this report for review?':decision==='resolved'?'Resolve this report?':'Dismiss this report?'))return;
  setBusy(true);setError('');setMessage('');
  try{const {error}=await supabase.rpc('admin_review_player_report',{report_id:report.id,decision,review_note:note});if(error)throw error;setMessage('Moderation action recorded in the audit log.');await loadReports();}
  catch(e){setError(e instanceof Error?e.message:'Moderation action failed.');}
  finally{setBusy(false);}
 }
 useEffect(()=>{load();loadReports('open');if(role==='admin'||role==='superadmin')loadShopProducts();},[]);
 async function search(e?:FormEvent){
  e?.preventDefault();if(!supabase)return;setBusy(true);setError('');
  try{const {data,error}=await supabase.rpc('admin_find_players',{search_text:term.trim()});if(error)throw error;setPlayers((data||[]) as AdminPlayer[]);}
  catch(e){setError(e instanceof Error?e.message:'Player search failed.');}
  finally{setBusy(false);}
 }
 async function setPlayerRole(player:AdminPlayer,next:Role){
  if(!supabase)return;
  if(!window.confirm('Change @'+player.username+' from '+player.role+' to '+next+'?'))return;
  setBusy(true);setError('');setMessage('');
  try{const {error}=await supabase.rpc('admin_set_player_role',{target_player_id:player.player_id,new_role:next});if(error)throw error;setMessage('Role updated and recorded in the audit log.');await search();}
  catch(e){setError(e instanceof Error?e.message:'Role update failed.');}
  finally{setBusy(false);}
 }
 return <section className="social-page admin-page">
  <div className="eyebrow">NETWORK / RESTRICTED OPERATIONS</div><h1>THE <em>BACKROOM.</em></h1>
  <p className="social-lead">Administrator access · {role.toUpperCase()}. Sensitive actions are enforced by database permissions, not hidden buttons.</p>
  {error&&<div className="auth-error">{error}</div>}{message&&<div className="auth-message">{message}</div>}
  <div className="admin-toolbar"><span><Shield size={15}/> AUTHORIZED SESSION</span><button className="social-muted" onClick={load} disabled={busy}><RefreshCw size={14}/> REFRESH</button></div>
  {overview&&<div className="admin-stats">
   <article><Users/><span>REGISTERED PLAYERS</span><b>{overview.players}</b></article>
   <article><Activity/><span>PENDING REQUESTS</span><b>{overview.pending_friend_requests}</b></article>
   <article><Bell/><span>UNREAD NOTIFICATIONS</span><b>{overview.unread_notifications}</b></article>
  </div>}
  <div className="admin-section"><div className="settings-title"><Users/><div><b>PLAYER DIRECTORY / MODERATION</b><span>Search player records and inspect assigned roles.</span></div></div>
   <form className="player-search" onSubmit={search}><Search size={18}/><input value={term} onChange={e=>setTerm(e.target.value)} placeholder="Search username, display name, or Player ID"/><button className="primary" disabled={busy}>SEARCH</button></form>
   {players.length>0&&<div className="player-list admin-player-list">{players.map(p=><article className="player-row" key={p.player_id}><div className="player-avatar"><Users size={16}/></div><div className="player-info"><b>{p.display_name}</b><span>@{p.username} · {p.player_id}</span></div><span className={'role-pill role-'+p.role}>{p.role}</span>{role==='superadmin'&&p.role!=='superadmin'&&<select className="role-select" value={p.role} disabled={busy} onChange={e=>setPlayerRole(p,e.target.value as Role)} aria-label={'Change role for '+p.username}><option value="player">PLAYER</option><option value="moderator">MODERATOR</option><option value="admin">ADMIN</option></select>}</article>)}</div>}
   {role!=='superadmin'&&<div className="admin-note">Role changes are restricted to superadministrators. This account has read-only role visibility.</div>}
  </div>
  <div className="admin-section"><div className="settings-title"><Shield/><div><b>PLAYER REPORTS / MODERATION QUEUE</b><span>Private reports. Review actions are permission-checked and audited.</span></div></div>
   <div className="report-toolbar"><label>QUEUE<select value={reportFilter} onChange={e=>{setReportFilter(e.target.value);loadReports(e.target.value)}}><option value="open">OPEN</option><option value="reviewing">IN REVIEW</option><option value="resolved">RESOLVED</option><option value="dismissed">DISMISSED</option><option value="all">ALL REPORTS</option></select></label><button className="social-muted" disabled={busy} onClick={()=>loadReports()}>REFRESH QUEUE</button></div>
   {reports.length? <div className="moderation-list">{reports.map(r=><article className="moderation-card" key={r.id}><div className="moderation-head"><b>{r.category.replace('_',' ').toUpperCase()}</b><span>{r.status.toUpperCase()}</span></div><p>REPORTER @{r.reporter_username} ({r.reporter_player_id})</p><p>TARGET @{r.target_username} ({r.target_player_id})</p><div className="moderation-details">{r.details||'No additional details provided.'}</div><small>{new Date(r.created_at).toLocaleString()}</small>{!['resolved','dismissed'].includes(r.status)&&<><textarea rows={2} maxLength={1000} placeholder="Internal moderator note (optional)" value={reviewNotes[r.id]||''} onChange={e=>setReviewNotes(v=>({...v,[r.id]:e.target.value}))}/><div className="player-controls">{r.status==='open'&&<button className="social-muted" disabled={busy} onClick={()=>reviewReport(r,'reviewing')}>TAKE REVIEW</button>}<button className="social-action" disabled={busy} onClick={()=>reviewReport(r,'resolved')}>RESOLVE</button><button className="social-muted danger" disabled={busy} onClick={()=>reviewReport(r,'dismissed')}>DISMISS</button></div></>}</article>)}</div>:<div className="empty-state">NO REPORTS IN THIS QUEUE.</div>}
  </div>
  {(role==='admin'||role==='superadmin')&&<div className="admin-section"><div className="settings-title"><ShoppingBag/><div><b>SHOP CATALOG CONTROL</b><span>Publish products into one destination and one currency only. No wallet funding controls here.</span></div></div>
   <form className="shop-admin-form" onSubmit={saveShopProduct}>
    <label>DESTINATION<select value={shopForm.game} onChange={e=>setShopForm(v=>({...v,game:e.target.value}))}>{['shyst','poker','realms','rituals','degen','mmo'].map(g=><option key={g} value={g}>{g.toUpperCase()}</option>)}</select></label>
    <label>SKU<input required minLength={2} maxLength={48} pattern="[A-Za-z0-9][A-Za-z0-9_-]+" value={shopForm.sku} onChange={e=>setShopForm(v=>({...v,sku:e.target.value.toUpperCase()}))}/></label>
    <label>DISPLAY NAME<input required maxLength={80} value={shopForm.name} onChange={e=>setShopForm(v=>({...v,name:e.target.value}))}/></label>
    <label>DESCRIPTION<input maxLength={500} value={shopForm.description} onChange={e=>setShopForm(v=>({...v,description:e.target.value}))}/></label>
    <label>CURRENCY CODE<input required minLength={2} maxLength={16} pattern="[A-Za-z0-9_]+" value={shopForm.currency} onChange={e=>setShopForm(v=>({...v,currency:e.target.value.toUpperCase()}))}/></label>
    <label>PRICE<input required type="number" min="1" step="1" value={shopForm.price} onChange={e=>setShopForm(v=>({...v,price:e.target.value}))}/></label>
    <label>ITEM TYPE<select value={shopForm.itemType} onChange={e=>setShopForm(v=>({...v,itemType:e.target.value}))}>{['cosmetic','consumable','unlock','bundle','other'].map(x=><option key={x}>{x}</option>)}</select></label>
    <label>ITEM KEY<input required maxLength={80} value={shopForm.itemKey} onChange={e=>setShopForm(v=>({...v,itemKey:e.target.value}))}/></label>
    <label>STOCK LIMIT<input type="number" min="0" step="1" placeholder="Blank = unlimited" value={shopForm.stock} onChange={e=>setShopForm(v=>({...v,stock:e.target.value}))}/></label>
    <label>PER-PLAYER LIMIT<input type="number" min="1" step="1" placeholder="Blank = unlimited" value={shopForm.limit} onChange={e=>setShopForm(v=>({...v,limit:e.target.value}))}/></label>
    <label className="shop-admin-check"><input type="checkbox" checked={shopForm.active} onChange={e=>setShopForm(v=>({...v,active:e.target.checked}))}/> PUBLISH IMMEDIATELY</label>
    <button className="primary" disabled={busy}>SAVE PRODUCT</button>
   </form>
   <div className="shop-admin-list">{shopProducts.map(p=><article key={p.id}><div><b>{p.name}</b><span>{p.game_key.toUpperCase()} / {p.sku} / {p.price} {p.currency_code}</span></div><button className={p.active?'social-muted danger':'social-action'} disabled={busy} onClick={()=>toggleShopProduct(p)}>{p.active?'DEACTIVATE':'PUBLISH'}</button></article>)}</div>
  </div>}
  {overview&&<><div className="admin-section"><div className="settings-title"><Gamepad2/><div><b>DESTINATION REGISTRY</b><span>Current catalog state from the database.</span></div></div><div className="admin-game-list">{overview.games.map(g=><div key={g.key}><b>{g.display_name}</b><span>{g.key}</span><i>{g.status}</i></div>)}</div></div>
  <div className="admin-section"><div className="settings-title"><Activity/><div><b>RECENT AUDIT EVENTS</b><span>Latest 25 recorded administrative and identity events.</span></div></div>{overview.recent_audit.length?<div className="audit-list">{overview.recent_audit.map(a=><div key={a.id}><b>{a.action}</b><span>{a.target_type||'event'} / {a.target_id||'—'}</span><small>{new Date(a.created_at).toLocaleString()}</small></div>)}</div>:<div className="empty-state">NO AUDIT EVENTS RECORDED YET.</div>}</div></>}
 </section>;
}
