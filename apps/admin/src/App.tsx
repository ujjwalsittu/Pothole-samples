import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppAuthProvider, RequireAdmin } from './auth/auth';
import { Layout } from './components/Layout';
import { ApprovalsPage } from './pages/Approvals';
import { AuditPage } from './pages/Audit';
import { CampaignsPage } from './pages/Campaigns';
import { DatasetsPage } from './pages/Datasets';
import { ExportsPage } from './pages/Exports';
import { LeaderboardPage } from './pages/Leaderboard';
import { MapPage } from './pages/MapPage';
import { OverviewPage } from './pages/Overview';
import { PackagesPage } from './pages/Packages';
import { ReviewQueuePage } from './pages/ReviewQueue';
import { SamplesPage } from './pages/Samples';
import { SettlementsPage } from './pages/Settlements';

export function App() {
  return (
    <BrowserRouter>
      <AppAuthProvider>
        <RequireAdmin>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<OverviewPage />} />
              <Route path="/approvals" element={<ApprovalsPage />} />
              <Route path="/review" element={<ReviewQueuePage />} />
              <Route path="/samples" element={<SamplesPage />} />
              <Route path="/map" element={<MapPage />} />
              <Route path="/campaigns" element={<CampaignsPage />} />
              <Route path="/packages" element={<PackagesPage />} />
              <Route path="/leaderboard" element={<LeaderboardPage />} />
              <Route path="/settlements" element={<SettlementsPage />} />
              <Route path="/datasets" element={<DatasetsPage />} />
              <Route path="/exports" element={<ExportsPage />} />
              <Route path="/audit" element={<AuditPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </RequireAdmin>
      </AppAuthProvider>
    </BrowserRouter>
  );
}
