import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/tokens.css';
import './styles/ui.css';
import './styles/shell.css';
import './styles/login.css';
import './styles/admin.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
