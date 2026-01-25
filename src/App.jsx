import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Layout } from './components/layout';
import { GamesPage, LeaderboardPage, StandingsPage } from './pages';
import './styles/global.css';

function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<GamesPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="standings" element={<StandingsPage />} />
          </Route>
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}

export default App;
