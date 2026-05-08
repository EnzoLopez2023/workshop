import React from 'react';
import { createRoot } from 'react-dom/client';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { BrowserRouter } from 'react-router-dom';
import { msalConfig } from './auth/msalConfig';
import AuthGuard from './auth/AuthGuard';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { setMsalInstance } from './services/api';
import './index.css';

const rootEl = document.getElementById('root')!;

function renderFatal(err: unknown) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'font-family:system-ui;padding:24px;max-width:640px;margin:40px auto;background:#fee2e2;border:1px solid #fca5a5;border-radius:12px;color:#7f1d1d';
  const title = document.createElement('h2');
  title.style.margin = '0 0 8px 0';
  title.textContent = 'Startup error';
  const pre = document.createElement('pre');
  pre.style.cssText = 'white-space:pre-wrap;font-size:12px';
  pre.textContent = String((err as Error)?.stack ?? err);
  wrap.append(title, pre);
  rootEl.replaceChildren(wrap);
  console.error('App startup failed', err);
}

try {
  const msalInstance = new PublicClientApplication(msalConfig);

  msalInstance
    .initialize()
    .then(() => {
      setMsalInstance(msalInstance);
      createRoot(rootEl).render(
        <React.StrictMode>
          <ErrorBoundary>
            <MsalProvider instance={msalInstance}>
              <AuthGuard>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
              </AuthGuard>
            </MsalProvider>
          </ErrorBoundary>
        </React.StrictMode>
      );
    })
    .catch(renderFatal);
} catch (err) {
  renderFatal(err);
}
