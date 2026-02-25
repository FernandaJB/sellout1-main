import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import AppWrapper from './App';
import { PrimeReactProvider } from 'primereact/api';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <PrimeReactProvider value={{ ripple: true, hideOverlaysOnDocumentScrolling: true }}>
      <AppWrapper />
    </PrimeReactProvider>
  </React.StrictMode>
);
