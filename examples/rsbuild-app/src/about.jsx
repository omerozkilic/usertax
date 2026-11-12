import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

function About() {
  return (
    <main>
      <h1>About</h1>
      <p>A second page with its own entry.</p>
      <p>
        <a href="/">Home</a>
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <About />
  </StrictMode>,
);
