import React from 'react';
import { createRoot } from 'react-dom/client';
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { msalConfig } from './auth/msalConfig';
import AuthGuard from './auth/AuthGuard';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { setMsalInstance } from './services/api';
import { setMsalInstance as setTabloomMsalInstance } from './services/tabloomApi';
import './index.css';

const rootEl = document.getElementById('root')!;
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

function renderFatal(err: unknown) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;padding:24px;max-width:640px;margin:40px auto;background:#F7F9F6;border:1px solid #B3271F;border-top:3px solid #B3271F;color:#14181A';
  const title = document.createElement('h2');
  title.style.margin = '0 0 8px 0';
  title.textContent = 'Startup error';
  title.style.cssText += 'text-transform:uppercase;letter-spacing:0.1em;font-size:15px';
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
      setTabloomMsalInstance(msalInstance);
      createRoot(rootEl).render(
        <React.StrictMode>
          <ErrorBoundary>
            <MsalProvider instance={msalInstance}>
              <AuthGuard>
                <RouterProvider router={router} />
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
