import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppAuthProvider, RequireAdmin } from './auth/auth';
import { Layout } from './components/Layout';
import { ApprovalsPage } from './pages/Approvals';
import { ExportsPage } from './pages/Exports';
import { OverviewPage } from './pages/Overview';
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
              <Route path="/settlements" element={<SettlementsPage />} />
              <Route path="/exports" element={<ExportsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </RequireAdmin>
      </AppAuthProvider>
    </BrowserRouter>
  );
}
