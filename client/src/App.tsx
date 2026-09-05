import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import type { Role } from './lib/types';
import TopNav from './components/TopNav';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import RideHome from './pages/customer/RideHome';
import Trips from './pages/customer/Trips';
import DriverHome from './pages/driver/DriverHome';
import DriverEarnings from './pages/driver/DriverEarnings';
import DriverVehicle from './pages/driver/DriverVehicle';

function Protected({ role, children }: { role: Role; children: JSX.Element }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (user.role !== role) return <Navigate to={user.role === 'driver' ? '/drive' : '/ride'} replace />;
  return children;
}

export default function App() {
  return (
    <div className="app-shell">
      <TopNav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          path="/ride"
          element={
            <Protected role="customer">
              <RideHome />
            </Protected>
          }
        />
        <Route
          path="/trips"
          element={
            <Protected role="customer">
              <Trips />
            </Protected>
          }
        />
        <Route
          path="/drive"
          element={
            <Protected role="driver">
              <DriverHome />
            </Protected>
          }
        />
        <Route
          path="/drive/earnings"
          element={
            <Protected role="driver">
              <DriverEarnings />
            </Protected>
          }
        />
        <Route
          path="/drive/vehicle"
          element={
            <Protected role="driver">
              <DriverVehicle />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
