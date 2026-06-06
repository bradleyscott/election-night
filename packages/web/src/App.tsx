import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout.js';
import Seats from './pages/Seats.js';
import Electorates from './pages/Electorates.js';
import Parties from './pages/Parties.js';
import CloseCalls from './pages/CloseCalls.js';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Seats />} />
        <Route path="/electorates" element={<Electorates />} />
        <Route path="/electorates/:name" element={<Electorates />} />
        <Route path="/parties" element={<Parties />} />
        <Route path="/close-calls" element={<CloseCalls />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
