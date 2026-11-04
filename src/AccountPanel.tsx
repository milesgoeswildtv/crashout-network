import { useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Save, ShieldCheck, UserRound } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib';

type Profile={player_id:string;username:string;display_name:string};
export default function AccountPanel({session,profile,onProfileUpdated}:{session:Session|null;profile:Profile|null;onProfileUpdated:(p:Profile)=>void}) {
  const [username,setUsername]=useState(profile?.username||'');
  const [displayName,setDisplayName]=useState(profile?.display_name||'');
  const [email,setEmail]=useState(session?.user.email||'');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  const [copied,setCopied]=useState(false);
  async function save(e:FormEvent) {
    e.preventDefault();if(!supabase)return;
    setBusy(true);setError('');setMessage('');
    try {
      const {data,error}=await supabase.rpc('update_player_identity',{new_username:username.trim(),new_display_name:displayName.trim()});
      if(error)throw error;
      const row=Array.isArray(data)?data[0]:data;
      if(!row)throw new Error('The profile update returned no player record.');
      onProfileUpdated({player_id:row.player_id,username:row.username,display_name:row.display_name});
      setUsername(row.username);setDisplayName(row.display_name);
      setMessage('Player identity saved.');
    } catch(e) {setError(e instanceof Error?e.message:'Could not save your identity.');}
    finally {setBusy(false);}
  }
  async function changeEmail(e:FormEvent) {
    e.preventDefault();if(!supabase||!email.trim())return;
    setBusy(true);setError('');setMessage('');
    try {const {error}=await supabase.auth.updateUser({email:email.trim()});if(error)throw error;setMessage('Check your new email address for a confirmation link. Your current email remains active until confirmed.');}
    catch(e){setError(e instanceof Error?e.message:'Could not start email change.');}
    finally{setBusy(false);}
  }
  async function resetPassword() {
    if(!supabase||!session?.user.email)return;
    setBusy(true);setError('');setMessage('');
    try{const {error}=await supabase.auth.resetPasswordForEmail(session.user.email,{redirectTo:window.location.origin});if(error)throw error;setMessage('A password reset link has been sent to your current email address.');}
    catch(e){setError(e instanceof Error?e.message:'Could not send password reset.');}
    finally{setBusy(false);}
  }
  async function copyId() {
    if(!profile)return;
    try{await navigator.clipboard.writeText(profile.player_id);setCopied(true);window.setTimeout(()=>setCopied(false),1600);}
    catch{setError('Clipboard access is unavailable in this browser.');}
  }
  if(!session)return <section className="social-page"><div className="eyebrow">NETWORK / ACCOUNT</div><h1>PLAYER <em>ACCESS.</em></h1><div className="empty-state">SIGN IN TO MANAGE YOUR ACCOUNT.</div></section>;
  return <section className="social-page account-page">
    <div className="eyebrow">NETWORK / ACCOUNT SETTINGS</div><h1>YOUR <em>IDENTITY.</em></h1>
    <p className="social-lead">Manage your public player identity and account security. Your Player ID cannot be changed.</p>
    {error&&<div className="auth-error">{error}</div>}{message&&<div className="auth-message">{message}</div>}
    <div className="account-id-card"><div className="player-avatar"><UserRound/></div><div><span>PERMANENT PLAYER ID</span><b>{profile?.player_id||'PROVISIONING'}</b></div><button className="social-muted" onClick={copyId} disabled={!profile}><Copy size={14}/>{copied?'COPIED':'COPY'}</button></div>
    <form className="settings-card" onSubmit={save}>
      <div className="settings-title"><UserRound size={17}/><div><b>PUBLIC IDENTITY</b><span>What other players see across the network.</span></div></div>
      <label>DISPLAY NAME<input value={displayName} onChange={e=>setDisplayName(e.target.value)} minLength={1} maxLength={32} required autoComplete="nickname"/></label>
      <label>USERNAME<input value={username} onChange={e=>setUsername(e.target.value)} minLength={3} maxLength={20} pattern="[A-Za-z0-9_]+" required autoComplete="username"/><small>3–20 letters, numbers, or underscores. Must be unique.</small></label>
      <button className="primary" disabled={busy||!profile}><Save size={15}/>{busy?'SAVING...':'SAVE IDENTITY'}</button>
    </form>
    <form className="settings-card" onSubmit={changeEmail}>
      <div className="settings-title"><ShieldCheck size={17}/><div><b>EMAIL ADDRESS</b><span>Changing email requires confirmation at the new address.</span></div></div>
      <label>ACCOUNT EMAIL<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label>
      <button className="social-action" disabled={busy||email.trim()===session.user.email}>REQUEST EMAIL CHANGE</button>
    </form>
    <div className="settings-card">
      <div className="settings-title"><KeyRound size={17}/><div><b>PASSWORD & SECURITY</b><span>Send a secure password reset link to your current account email.</span></div></div>
      <button className="social-action" onClick={resetPassword} disabled={busy||!session.user.email}>SEND PASSWORD RESET LINK</button>
    </div>
  </section>;
}
