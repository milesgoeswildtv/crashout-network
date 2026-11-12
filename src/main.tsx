import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import OAuthConsent from './OAuthConsent';
import './style.css';
const Page = window.location.pathname === '/oauth/consent' ? OAuthConsent : App;
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Page /></React.StrictMode>);
