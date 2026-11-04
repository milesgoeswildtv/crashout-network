import { useEffect, useState, type FormEvent } from 'react';
import { Activity, Search, Shield, Users, Bell, Gamepad2, RefreshCw } from 'lucide-react';
import { supabase } from './lib';

type Role='player'|'moderator'|'admin'|'superadmin';
type AdminPlayer={player_id:string;username:string;display_name:string;role:Role;created_at:string};
type Overview={players:number;pending_friend_requests:number;unread_notifications:number;games:{key:string;display_name:string;status:string}[];recent_audit:{id:number;actor:string|null;action:string;target_type:string|null;target_id:string|null;created_at:string}[]};
export default function AdminPanel({role}:{role:Role}) {
 const [overview,setOverview]=useState<Overview|null>(null);
 const [players,setPlayers]=useState<AdminPlayer[]>([]);
 const [term,setTerm]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 async function load(){
  if(!supabase)return;setBusy(true);setError('');
  try{const {data,error}=await supabase.rpc('admin_network_overview');if(error)throw error;setOverview(data as Overview);}
  catch(e){setError(e instanceof Error?e.message:'Could not load admin overview.');}
  finally{setBusy(false);}
 }
 useEffect(()=>{load();},[]);
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
  {overview&&<><div className="admin-section"><div className="settings-title"><Gamepad2/><div><b>DESTINATION REGISTRY</b><span>Current catalog state from the database.</span></div></div><div className="admin-game-list">{overview.games.map(g=><div key={g.key}><b>{g.display_name}</b><span>{g.key}</span><i>{g.status}</i></div>)}</div></div>
  <div className="admin-section"><div className="settings-title"><Activity/><div><b>RECENT AUDIT EVENTS</b><span>Latest 25 recorded administrative and identity events.</span></div></div>{overview.recent_audit.length?<div className="audit-list">{overview.recent_audit.map(a=><div key={a.id}><b>{a.action}</b><span>{a.target_type||'event'} / {a.target_id||'—'}</span><small>{new Date(a.created_at).toLocaleString()}</small></div>)}</div>:<div className="empty-state">NO AUDIT EVENTS RECORDED YET.</div>}</div></>}
 </section>;
}
