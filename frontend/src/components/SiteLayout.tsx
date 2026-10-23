import { useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { LogoBadge, Wordmark } from "./Logo";

/** Public site frame, HW 4 style: announcement bar, links left, logo centered, account links right. */
export default function SiteLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const cls = ({ isActive }: { isActive: boolean }) => `nav-link${isActive ? " active" : ""}`;

  return (
    <div className="site">
      <header className="site-header">
        <div className="announcement">Custom cakes by request · New Haven, Connecticut</div>
        <div className="navbar">
          <button className="nav-toggle" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <span />
            <span />
            <span />
          </button>
          <nav className={`nav-links nav-left ${open ? "open" : ""}`} aria-label="Main">
            <NavLink to="/menu" className={cls} onClick={close}>Menu &amp; pricing</NavLink>
            <NavLink to="/gallery" className={cls} onClick={close}>Gallery</NavLink>
            <NavLink to="/order" className={cls} onClick={close}>Order a cake</NavLink>
          </nav>
          <Link to="/" className="brand-link" onClick={close} aria-label="Garden Party Cake Studio home">
            <Wordmark height={64} />
          </Link>
          <nav className={`nav-links nav-right ${open ? "open" : ""}`} aria-label="Account">
            {user?.role === "staff" && (
              <NavLink to="/staff" className={cls} onClick={close}>Studio</NavLink>
            )}
            {user ? (
              <>
                <NavLink to="/account" className={cls} onClick={close}>My orders</NavLink>
                <button
                  className="nav-link nav-button"
                  onClick={async () => {
                    close();
                    await logout();
                    nav("/");
                  }}
                >
                  Sign out
                </button>
              </>
            ) : (
              <NavLink to="/login" className={cls} onClick={close}>Sign in / Sign up</NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="site-main">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div className="container footer-grid">
          <div className="footer-brand">
            <LogoBadge size={112} onMoss />
            <p className="muted small">Fruits, florals, foliage. Natural special-occasion cakes from a home kitchen in New Haven, CT.</p>
          </div>
          <div>
            <h4>Ordering</h4>
            <ul className="plain">
              <li><Link to="/order">Start an order</Link></li>
              <li><Link to="/menu">Sizes &amp; pricing</Link></li>
              <li><Link to="/gallery">Inspiration</Link></li>
            </ul>
          </div>
          <div>
            <h4>Good to know</h4>
            <ul className="plain small muted">
              <li>At least 7 days' notice</li>
              <li>50% deposit holds your date</li>
              <li>Buttercream only, no fondant</li>
            </ul>
          </div>
          <div>
            <h4>Say hello</h4>
            <p className="small muted">
              Instagram <a href="https://www.instagram.com/gardenpartycakes/" target="_blank" rel="noreferrer">@gardenpartycakes</a>
            </p>
            <p className="tiny muted">Class project for MGT409 at Yale SOM. No payments are processed.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
