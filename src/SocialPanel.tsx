import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Bell, Check, Search, UserPlus, UserRound } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib';

type Player = { player_id:string; username:string; display_name:string; avatar_url:string|null };
type RequestRow = { id:string; requester:string; player?:Player };
type PublicProfile={player_id:string;username:string;display_name:string;joined_at:string;friend_count:number};
type NotificationRow = { id:string; title:string; body:string; read_at:string|null; created_at:string };

export default function SocialPanel({session,mode}:{session:Session|null;mode:'PLAYERS'|'NOTIFICATIONS'}) {
  const [term,setTerm]=useState('');
  const [results,setResults]=useState<Player[]>([]);
  const [requests,setRequests]=useState<RequestRow[]>([]);
  const [friends,setFriends]=useState<Player[]>([]);
  const [blocked,setBlocked]=useState<Player[]>([]);
  const [notifications,setNotifications]=useState<NotificationRow[]>([]);
  const [selectedProfile,setSelectedProfile]=useState<PublicProfile|null>(null);
  const [reportCategory,setReportCategory]=useState('other');
  const [reportDetails,setReportDetails]=useState('');
  const [reporting,setReporting]=useState(false);
  const [reportMessage,setReportMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  async function refresh() {
    if(!supabase)return;
    if(!session){setRequests([]);setFriends([]);setBlocked([]);setNotifications([]);setResults([]);return;}
    setBusy(true);setError('');
    try {
      const [rq,fr,no,bl]=await Promise.all([
        supabase.from('friendships').select('id,requester').eq('addressee',session.user.id).eq('status','pending').order('created_at',{ascending:false}),
        supabase.from('friendships').select('requester,addressee').eq('status','accepted').or('requester.eq.'+session.user.id+',addressee.eq.'+session.user.id),
        supabase.from('notifications').select('id,title,body,read_at,created_at').order('created_at',{ascending:false}).limit(30),
        supabase.from('user_blocks').select('blocked').order('created_at',{ascending:false})
      ]);
      if(rq.error)throw rq.error;if(fr.error)throw fr.error;if(no.error)throw no.error;if(bl.error)throw bl.error;
      const requestRows=(rq.data||[]) as RequestRow[];
      const friendIds=[...new Set((fr.data||[]).map((r:any)=>r.requester===session.user.id?r.addressee:r.requester))];
      const blockedIds=(bl.data||[]).map((r:any)=>r.blocked as string);
      const ids=[...new Set([...requestRows.map(r=>r.requester),...friendIds,...blockedIds])];
      const pr=ids.length?await supabase.from('profiles').select('id,player_id,username,display_name,avatar_url').in('id',ids):{data:[],error:null};
      if(pr.error)throw pr.error;
      const map=new Map((pr.data||[]).map((p:any)=>[p.id,p]));
      setRequests(requestRows.map(r=>({...r,player:map.get(r.requester)})));
      setFriends(friendIds.map(id=>map.get(id)).filter(Boolean) as Player[]);
      setBlocked(blockedIds.map(id=>map.get(id)).filter(Boolean) as Player[]);
      setNotifications((no.data||[]) as NotificationRow[]);
    } catch(e) { setError(e instanceof Error?e.message:'Could not load network data.'); }
    finally { setBusy(false); }
  }
  useEffect(()=>{refresh();},[session?.user.id,mode]);
  async function search(e:FormEvent) {
    e.preventDefault();if(!supabase||!session)return;
    setBusy(true);setError('');
    try {const {data,error}=await supabase.rpc('search_players',{search_text:term.trim()});if(error)throw error;setResults((data||[]) as Player[]);}
    catch(e){setError(e instanceof Error?e.message:'Search failed.');}finally{setBusy(false);}
  }
  async function add(p:Player) {
    if(!supabase)return;setBusy(true);setError('');
    try{const {error}=await supabase.rpc('send_friend_request',{target_username:p.username});if(error)throw error;setResults(v=>v.filter(x=>x.player_id!==p.player_id));await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Could not send request.');}finally{setBusy(false);}
  }
  async function respond(id:string,accept:boolean) {
    if(!supabase)return;setBusy(true);setError('');
    try{const {error}=await supabase.rpc('respond_friend_request',{request_id:id,accept_request:accept});if(error)throw error;await refresh();}
    catch(e){setError(e instanceof Error?e.message:'Could not update request.');}finally{setBusy(false);}
  }
  async function viewProfile(p:Player) {
    if(!supabase)return;
    setBusy(true);setError('');
    try {
      const {data,error}=await supabase.rpc('get_public_player_profile',{target_player_id:p.player_id});
      if(error)throw error;
      const row=Array.isArray(data)?data[0]:data;
      if(!row)throw new Error('This player profile is unavailable.');
      setSelectedProfile(row as PublicProfile);
    } catch(e) {setError(e instanceof Error?e.message:'Could not open player profile.');}
    finally {setBusy(false);}
  }
  async function submitReport(e:FormEvent) {
    e.preventDefault();
    if(!supabase||!selectedProfile)return;
    if(!window.confirm('Submit a report about @'+selectedProfile.username+'? False or abusive reports may result in account action.'))return;
    setReporting(true);setError('');setReportMessage('');
    try {
      const {error}=await supabase.rpc('submit_player_report',{target_player_id:selectedProfile.player_id,report_category:reportCategory,report_details:reportDetails.trim()});
      if(error)throw error;
      setReportDetails('');setReportMessage('REPORT SUBMITTED. The moderation team can now review it.');
    } catch(e) {setError(e instanceof Error?e.message:'Could not submit report.');}
    finally {setReporting(false);}
  }
  async function friendAction(p:Player,kind:'remove'|'block'|'unblock') {
    if(!supabase)return;
    const prompt=kind==='block'?'Block @'+p.username+'? This removes the friendship and prevents future contact.':kind==='unblock'?'Unblock @'+p.username+'? They may be able to find and contact you again.':'Remove @'+p.username+' from your friends?';
    if(!window.confirm(prompt))return;
    setBusy(true);setError('');
    try {
      const {error}=await supabase.rpc(kind==='block'?'block_player':kind==='unblock'?'unblock_player':'remove_friend',{target_player_id:p.player_id});
      if(error)throw error;
      if(selectedProfile?.player_id===p.player_id)setSelectedProfile(null);
      await refresh();
    } catch(e) {setError(e instanceof Error?e.message:'Could not update friend.');}
    finally {setBusy(false);}
  }
  async function read(n:NotificationRow) {
    if(!supabase||n.read_at)return;
    const {error}=await supabase.rpc('mark_notification_read',{notification_id:n.id});
    if(error)setError(error.message);else setNotifications(v=>v.map(x=>x.id===n.id?{...x,read_at:new Date().toISOString()}:x));
  }
  const playerRow=(p:Player,action?:ReactNode)=><article className="player-row" key={p.player_id}><div className="player-avatar">{p.avatar_url?<img src={p.avatar_url} alt="" loading="lazy"/>:<UserRound/>}</div><div className="player-info"><b>{p.display_name}</b><span>@{p.username} · {p.player_id}</span></div>{action}</article>;
  return <section className="social-page">
    <div className="eyebrow">NETWORK / {mode==='PLAYERS'?'PLAYER DIRECTORY':'INBOX'}</div>
    <h1>{mode==='PLAYERS'?<>FIND YOUR <em>PEOPLE.</em></>:<>YOUR <em>INBOX.</em></>}</h1>
    <p className="social-lead">{mode==='PLAYERS'?'Search by username, display name, or six-character Player ID.':'Friend requests and network updates.'}</p>
    {!session?<div className="empty-state">SIGN IN TO ACCESS YOUR NETWORK.</div>:mode==='PLAYERS'?<>
      {selectedProfile&&<article className="public-profile-card"><div className="public-profile-top"><div className="player-avatar"><UserRound/></div><div><span>CRASHOUT PLAYER</span><h2>{selectedProfile.display_name}</h2><b>@{selectedProfile.username}</b></div><button className="social-muted" onClick={()=>setSelectedProfile(null)}>CLOSE</button></div><div className="public-profile-stats"><div><span>PLAYER ID</span><b>{selectedProfile.player_id}</b></div><div><span>FRIENDS</span><b>{selectedProfile.friend_count}</b></div><div><span>JOINED</span><b>{new Date(selectedProfile.joined_at).toLocaleDateString()}</b></div></div><form className="report-form" onSubmit={submitReport}><div className="settings-title"><span>REPORT THIS PLAYER</span></div><label>REASON<select value={reportCategory} onChange={e=>setReportCategory(e.target.value)}><option value="harassment">Harassment</option><option value="cheating">Cheating</option><option value="impersonation">Impersonation</option><option value="spam">Spam</option><option value="other">Other</option></select></label><label>DETAILS (OPTIONAL)<textarea value={reportDetails} onChange={e=>setReportDetails(e.target.value)} maxLength={1000} rows={3} placeholder="Describe what happened. Stick to relevant details."/></label><button className="social-muted danger" disabled={reporting}>{reporting?'SUBMITTING...':'SUBMIT REPORT'}</button>{reportMessage&&<div className="auth-message">{reportMessage}</div>}</form></article>}<form className="player-search" onSubmit={search}><Search size={18}/><input value={term} onChange={e=>setTerm(e.target.value)} minLength={2} placeholder="Search players..." aria-label="Search players"/><button className="primary" disabled={busy||term.trim().length<2}>SEARCH</button></form>
      {error&&<div className="auth-error">{error}</div>}
      {results.length>0&&<><h2 className="social-heading">SEARCH RESULTS</h2><div className="player-list">{results.map(p=>playerRow(p,<div className="player-controls"><button className="social-muted" disabled={busy} onClick={()=>viewProfile(p)}>VIEW</button><button className="social-action" disabled={busy} onClick={()=>add(p)}><UserPlus size={15}/> ADD</button></div>))}</div></>}
      {requests.length>0&&<><h2 className="social-heading">INCOMING REQUESTS <small>{requests.length}</small></h2><div className="player-list">{requests.map(r=><article className="player-row" key={r.id}><div className="player-avatar"><UserRound/></div><div className="player-info"><b>{r.player?.display_name||'CRASHOUT PLAYER'}</b><span>@{r.player?.username||'unknown'} · {r.player?.player_id||''}</span></div><button className="social-action" disabled={busy} onClick={()=>respond(r.id,true)}><Check size={15}/> ACCEPT</button><button className="social-muted" disabled={busy} onClick={()=>respond(r.id,false)}>DECLINE</button></article>)}</div></>}
      <h2 className="social-heading">YOUR FRIENDS <small>{friends.length}</small></h2>
      {friends.length?<div className="player-list">{friends.map(p=>playerRow(p,<div className="player-controls"><button className="social-muted" disabled={busy} onClick={()=>viewProfile(p)}>VIEW</button><button className="social-muted" disabled={busy} onClick={()=>friendAction(p,'remove')}>REMOVE</button><button className="social-muted danger" disabled={busy} onClick={()=>friendAction(p,'block')}>BLOCK</button></div>))}</div>:<div className="empty-state">NO CONNECTIONS YET. FIND YOUR PEOPLE ABOVE.</div>}\n      <h2 className="social-heading">BLOCKED PLAYERS <small>{blocked.length}</small></h2>\n      {blocked.length?<div className="player-list">{blocked.map(p=>playerRow(p,<button className="social-muted" disabled={busy} onClick={()=>friendAction(p,'unblock')}>UNBLOCK</button>))}</div>:<div className="empty-state">NO BLOCKED PLAYERS.</div>}
    </>:<>
      {error&&<div className="auth-error">{error}</div>}
      {notifications.length?<div className="player-list">{notifications.map(n=><article className={'notification-row '+(n.read_at?'read':'unread')} key={n.id} onClick={()=>read(n)}><div className="notification-mark"><Bell size={16}/></div><div className="player-info"><b>{n.title}</b><span>{n.body}</span><small>{new Date(n.created_at).toLocaleString()}</small></div>{!n.read_at&&<i className="unread-dot"/>}</article>)}</div>:<div className="empty-state">NOTHING HERE. THE SILENCE IS TEMPORARY.</div>}
    </>}
  </section>;
}
