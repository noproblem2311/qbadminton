import { HomePage } from './pages/HomePage';
import { RawPostsPage } from './pages/RawPostsPage';

export function App() {
  const path = window.location.pathname.replace(/\/+$/u, '') || '/';
  return path === '/raw' ? <RawPostsPage /> : <HomePage />;
}
