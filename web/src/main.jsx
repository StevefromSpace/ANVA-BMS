import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { startTransport } from './core/store.js';
import './styles.css';

import { startScheduler } from './core/scheduler.js';

startTransport();
startScheduler();
createRoot(document.getElementById('root')).render(<HashRouter><App /></HashRouter>);
