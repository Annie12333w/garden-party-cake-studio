import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "./auth";
import SiteLayout from "./components/SiteLayout";
import StaffLayout from "./components/StaffLayout";
import HomePage from "./pages/HomePage";
import MenuPage from "./pages/MenuPage";
import GalleryPage from "./pages/GalleryPage";
import OrderPage from "./pages/OrderPage";
import LoginPage from "./pages/LoginPage";
import AccountPage from "./pages/AccountPage";
import StaffDashboard from "./pages/staff/StaffDashboard";
import StaffOrders from "./pages/staff/StaffOrders";
import StaffCalendar from "./pages/staff/StaffCalendar";
import StaffPlan from "./pages/staff/StaffPlan";
import StaffShopping from "./pages/staff/StaffShopping";
import StaffInventory from "./pages/staff/StaffInventory";
import StaffRecipes from "./pages/staff/StaffRecipes";
import StaffCash from "./pages/staff/StaffCash";
import StaffRuns from "./pages/staff/StaffRuns";
import StaffTokenomics from "./pages/staff/StaffTokenomics";
import StaffSafety from "./pages/staff/StaffSafety";
import StaffDrafts from "./pages/staff/StaffDrafts";
import StaffSettings from "./pages/staff/StaffSettings";

function RequireAuth({ children, role }: { children: ReactNode; role?: "staff" | "customer" }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="page-loading">Loading…</div>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />;
  if (role === "staff" && user.role !== "staff")
    return (
      <div className="container narrow section">
        <h1 className="display">Staff only</h1>
        <p>This area is for the studio. Your orders are in <a href="/account">your account</a>.</p>
      </div>
    );
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<SiteLayout />}>
        <Route index element={<HomePage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="gallery" element={<GalleryPage />} />
        <Route path="order" element={<OrderPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route
          path="account"
          element={
            <RequireAuth>
              <AccountPage />
            </RequireAuth>
          }
        />
      </Route>
      <Route
        path="staff"
        element={
          <RequireAuth role="staff">
            <StaffLayout />
          </RequireAuth>
        }
      >
        <Route index element={<StaffDashboard />} />
        <Route path="orders" element={<StaffOrders />} />
        <Route path="orders/:id" element={<StaffOrders />} />
        <Route path="calendar" element={<StaffCalendar />} />
        <Route path="plan" element={<StaffPlan />} />
        <Route path="shopping" element={<StaffShopping />} />
        <Route path="inventory" element={<StaffInventory />} />
        <Route path="recipes" element={<StaffRecipes />} />
        <Route path="cash" element={<StaffCash />} />
        <Route path="runs" element={<StaffRuns />} />
        <Route path="runs/:runId" element={<StaffRuns />} />
        <Route path="tokenomics" element={<StaffTokenomics />} />
        <Route path="safety" element={<StaffSafety />} />
        <Route path="drafts" element={<StaffDrafts />} />
        <Route path="settings" element={<StaffSettings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
