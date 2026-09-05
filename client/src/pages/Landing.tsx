import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { APP_NAME } from '../lib/brand';

export default function Landing() {
  const { user } = useAuth();
  const nav = useNavigate();
  const go = () => nav(user ? (user.role === 'driver' ? '/drive' : '/ride') : '/signup');

  return (
    <main className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1>Go anywhere. <em>Pick your own route.</em></h1>
          <p className="lede">
            Request a ride, choose the road you want to take, and pay for exactly the kilometres you travel. No surge
            surprises: the price is on the screen before you tap.
          </p>
          <form
            className="hero-form"
            onSubmit={(e) => {
              e.preventDefault();
              go();
            }}
          >
            <label className="field">
              <span className="dot dot-pickup" />
              <input placeholder="Enter pickup location" />
            </label>
            <label className="field">
              <span className="dot dot-dropoff" />
              <input placeholder="Enter destination" />
            </label>
            <div className="hero-actions">
              <button className="btn btn-primary" type="submit">
                See prices
              </button>
              <Link to="/login" className="link">
                Log in to see your recent activity
              </Link>
            </div>
          </form>
        </div>
        <div className="hero-art" aria-hidden>
          <div className="hero-map">
            <svg viewBox="0 0 400 300" preserveAspectRatio="none">
              <path d="M20 250 C 80 180, 120 260, 180 190 S 300 120, 380 60" className="art-alt" />
              <path d="M20 250 C 100 230, 140 140, 220 150 S 320 90, 380 60" className="art-main" />
              <circle cx="20" cy="250" r="8" className="art-pin" />
              <circle cx="380" cy="60" r="8" className="art-pin art-pin-end" />
              <circle cx="220" cy="150" r="6" className="art-stop" />
            </svg>
            <div className="art-card">
              <strong>Route B</strong>
              <span>18.2 km · 27 min</span>
              <b>₹259</b>
            </div>
          </div>
        </div>
      </section>

      <section className="features">
        <article>
          <h3>You choose the route</h3>
          <p>See every route option on the map, add stops, drag the line to your favourite road. The fare updates live.</p>
        </article>
        <article>
          <h3>Pay per kilometre</h3>
          <p>A transparent formula: base fare + price per km × distance + a small time component. Nothing hidden.</p>
        </article>
        <article>
          <h3>Drivers earn on their terms</h3>
          <p>Go online when you want, see the fare and distance before you accept, and track earnings by day.</p>
        </article>
      </section>

      <section className="drive-cta">
        <div>
          <h2>Drive when you want, make what you need</h2>
          <p>Make money on your schedule with deliveries or rides, or both. You can use your own car or bike.</p>
          <Link to="/signup?role=driver" className="btn btn-primary">
            Get started
          </Link>
        </div>
      </section>

      <footer className="footer">{APP_NAME} · a study project · maps © OpenStreetMap contributors</footer>
    </main>
  );
}
