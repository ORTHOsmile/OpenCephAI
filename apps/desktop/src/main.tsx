import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { UpgradeGate } from './library/UpgradeGate';
import './styles/tokens.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><UpgradeGate><App /></UpgradeGate></React.StrictMode>);
