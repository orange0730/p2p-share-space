import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import './lib/install'; // 盡早監聽 beforeinstallprompt

// 不使用 StrictMode：開發模式下的重複掛載會建立兩個同 ID 的 Peer，導致房間代碼衝突
createRoot(document.getElementById('root')).render(<App />);
