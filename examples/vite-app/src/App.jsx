import { lazy, Suspense, useState } from 'react';

// Loaded on demand, so it becomes its own chunk.
const Details = lazy(() => import('./Details.jsx'));

export function App() {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <h1>usertax example</h1>
      <p>A small Vite + React app used to test usertax measurements.</p>
      <button type="button" onClick={() => setOpen((value) => !value)}>
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <Suspense fallback={<p>Loading…</p>}>
          <Details />
        </Suspense>
      )}
      <p>
        <a href="/about/">About</a>
      </p>
    </main>
  );
}
