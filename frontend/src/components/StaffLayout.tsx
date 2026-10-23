import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Wordmark } from "./Logo";

const NAV: { to: string; label: string; icon: string; end?: boolean }[] = [
  { to: "/staff", label: "Dashboard", icon: "❀", end: true },
  { to: "/staff/orders", label: "Orders", icon: "✉" },
  { to: "/staff/calendar", label: "Calendar", icon: "▦" },
  { to: "/staff/plan", label: "Production plan", icon: "⏱" },
  { to: "/staff/shopping", label: "Shopping list", icon: "🧺" },
  { to: "/staff/inventory", label: "Inventory", icon: "▤" },
  { to: "/staff/recipes", label: "Recipes", icon: "📖" },
  { to: "/staff/cash", label: "Cash", icon: "$" },
  { to: "/staff/runs", label: "Agent runs", icon: "✿" },
  { to: "/staff/tokenomics", label: "Tokenomics", icon: "◔" },
  { to: "/staff/safety", label: "Safety", icon: "⛨" },
  { to: "/staff/drafts", label: "Email drafts", icon: "✎" },
  { to: "/staff/settings", label: "Settings", icon: "⚙" },
];

export default function StaffLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <div className={`staff ${open ? "nav-open" : ""}`}>
      <aside className="staff-side">
        <Link to="/" className="brand-link" aria-label="Back to the shop">
          <Wordmark height={50} />
        </Link>
        <p className="tiny muted side-tag">Studio portal</p>
        <nav aria-label="Studio">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}>
              <span className="nav-ico" aria-hidden="true">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="side-foot">
          <p className="small">{user?.name}</p>
          <button
            className="link-btn small"
            onClick={async () => {
              await logout();
              nav("/");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="staff-main">
        <div className="staff-topbar">
          <button className="nav-toggle staff-toggle" aria-label="Open studio menu" onClick={() => setOpen((o) => !o)}>
            <span />
            <span />
            <span />
          </button>
          <span className="tiny muted">Garden Party Cake Studio · staff</span>
          <Link to="/" className="small">View shop →</Link>
        </div>
        <div className="staff-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
