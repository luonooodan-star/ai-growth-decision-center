import React from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from 'react-error-boundary';

import RoutesComponent from './app.tsx';
import './index.css';
import { Button } from '@client/src/components/ui/button';
import { Toaster } from '@client/src/components/ui/sonner';

const CLIENT_BASE_PATH = process.env.CLIENT_BASE_PATH || '/';

const MainApp = () => {
  return (
    <BrowserRouter basename={CLIENT_BASE_PATH}>
      <ErrorBoundary
        fallbackRender={({ error, resetErrorBoundary }) => (
          <main className="mx-auto max-w-2xl px-6 py-20 text-center">
            <h1 className="text-xl font-semibold text-slate-950">
              页面运行异常
            </h1>
            <p className="mt-3 text-sm text-slate-500">
              {error instanceof Error ? error.message : '请稍后重试'}
            </p>
            <Button className="mt-6" onClick={resetErrorBoundary} type="button">
              重试
            </Button>
          </main>
        )}
      >
        <RoutesComponent />
        {createPortal(<Toaster />, document.body)}
      </ErrorBoundary>
    </BrowserRouter>
  );
};

const rootElement: HTMLElement | null = document.getElementById('root');
if (!rootElement) throw new Error('页面根节点不存在');
createRoot(rootElement).render(<MainApp />);
