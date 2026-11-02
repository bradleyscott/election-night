import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.js';
import { WinPercentProvider } from './components/WinPercentDrawer.js';
import Seats from './pages/Seats.js';
import CloseCalls from './pages/CloseCalls.js';
import Electorates from './pages/Electorates.js';
import Parties from './pages/Parties.js';
import Candidates from './pages/Candidates.js';
import Flipped from './pages/Flipped.js';
import Feed from './pages/Feed.js';
import Trends from './pages/Trends.js';
import { CLOSE_CALLS_PATH } from './lib/routes.js';

export default function App() {
  return (
    <WinPercentProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Seats />} />
          <Route path="/electorates" element={<Electorates />} />
          <Route path="/electorates/:name" element={<Electorates />} />
          <Route path="/parties" element={<Parties />} />
          <Route path={CLOSE_CALLS_PATH} element={<CloseCalls />} />
          <Route path="/candidates" element={<Candidates />} />
          <Route path="/flipped" element={<Flipped />} />
          <Route path="/feed" element={<Feed />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </WinPercentProvider>
  );
}
