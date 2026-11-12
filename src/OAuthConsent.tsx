import { useEffect, useState } from 'react';
import { ArrowUpRight, LoaderCircle, ShieldCheck } from 'lucide-react';
import { supabase } from './lib';

type ConsentDetails = {
  authorization_id: string;
  redirect_uri: string;
  client: { id: string; name: string; uri: string; logo_uri: string };
  user: { id: string; email: string };
  scope: string;
};

const scopeCopy: Record<string, string> = {
  openid: 'Confirm your CRASHOUT identity',
  email: 'Share your email address and verification status',
  profile: 'Share basic profile information',
  phone: 'Share your phone number and verification status',
};

export default function OAuthConsent() {
  const [details, setDetails] = useState<ConsentDetails | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!supabase) {
        setError('CRASHOUT authentication is not configured.');
        return;
      }
      const authorizationId = new URLSearchParams(window.location.search).get('authorization_id');
      if (!authorizationId || authorizationId.length > 512) {
        setError('This authorization request is missing or invalid.');
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) {
        setError('Your CRASHOUT session could not be verified. Please sign in again.');
        return;
      }
      if (!sessionData.session) {
        const returnPath = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
        sessionStorage.setItem('crashout.oauth.return', returnPath);
        window.location.replace('/?oauth=signin');
        return;
      }

      const { data, error: detailsError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (detailsError) {
        setError(detailsError.message || 'This authorization request could not be loaded.');
        return;
      }
      if ('redirect_url' in data) {
        window.location.replace(data.redirect_url);
        return;
      }
      setDetails(data);
    };

    void load().catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Unable to load authorization details.');
    });
    return () => { active = false; };
  }, []);

  async function decide(approve: boolean) {
    if (!supabase || !details || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = approve
        ? await supabase.auth.oauth.approveAuthorization(details.authorization_id, { skipBrowserRedirect: true })
        : await supabase.auth.oauth.denyAuthorization(details.authorization_id, { skipBrowserRedirect: true });
      if (result.error) throw result.error;
      window.location.assign(result.data.redirect_url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your decision could not be submitted.');
      setBusy(false);
    }
  }

  const scopes = details?.scope.split(/\s+/).filter(Boolean) ?? [];

  return (
    <main className="oauth-consent-page">
      <section className="oauth-consent-card" aria-labelledby="oauth-consent-title">
        <div className="oauth-consent-brand"><span className="brand-mark">C</span><span>CRASHOUT<span className="brand-dot">.</span></span></div>
        <div className="eyebrow">NETWORK IDENTITY / AUTHORIZATION</div>
        <div className="oauth-consent-icon"><ShieldCheck size={25}/></div>
        <h1 id="oauth-consent-title">AN APP WANTS<br/><em>TO CONNECT.</em></h1>
        {details ? (
          <>
            <p className="oauth-consent-lead"><strong>{details.client.name}</strong> is requesting permission to use your CRASHOUT identity.</p>
            <div className="oauth-consent-details">
              <div><span>CRASHOUT ACCOUNT</span><b>{details.user.email}</b></div>
              <div><span>REGISTERED CALLBACK</span><b className="oauth-break">{details.redirect_uri}</b></div>
              <div><span>REQUESTED IDENTITY PERMISSIONS</span>
                {scopes.length ? <ul>{scopes.map((scope) => <li key={scope}><b>{scope}</b><small>{scopeCopy[scope] || 'Additional identity information requested by this client'}</small></li>)}</ul> : <b>No identity scopes specified</b>}
              </div>
            </div>
            <p className="oauth-consent-footnote">These scopes describe identity information. Access to CRASHOUT network data is separately controlled by application-specific server permissions.</p>
            <div className="oauth-consent-actions">
              <button className="oauth-deny" disabled={busy} onClick={() => void decide(false)}>DENY</button>
              <button className="primary" disabled={busy} onClick={() => void decide(true)}>{busy ? <><LoaderCircle className="spin" size={16}/> WORKING...</> : <>ALLOW ACCESS <ArrowUpRight size={16}/></>}</button>
            </div>
          </>
        ) : error ? (
          <>
            <p className="oauth-consent-error" role="alert">{error}</p>
            <button className="primary" onClick={() => window.location.assign('/')}>RETURN TO CRASHOUT <ArrowUpRight size={16}/></button>
          </>
        ) : (
          <p className="oauth-consent-lead"><LoaderCircle className="spin" size={18}/> Verifying the authorization request…</p>
        )}
        <div className="oauth-consent-safe">Never approve a request you did not initiate.</div>
      </section>
    </main>
  );
}
