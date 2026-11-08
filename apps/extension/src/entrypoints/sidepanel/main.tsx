import { ToastProvider } from '@ferry/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { z } from 'zod';
import { App } from '../../sidepanel/App';
import '../../sidepanel/styles.css';

z.config({ jitless: true });

const container = document.getElementById('root');
if (container !== null) {
  createRoot(container).render(
    <StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </StrictMode>,
  );
}
