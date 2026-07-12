import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.js';
import { SocketProvider } from './context/SocketProvider.js';
import PwaUpdatePrompt from './components/PwaUpdatePrompt.js';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SocketProvider>
        <App />
        <PwaUpdatePrompt />
      </SocketProvider>
    </BrowserRouter>
  </StrictMode>
);
