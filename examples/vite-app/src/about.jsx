import { createRoot } from 'react-dom/client';
import './styles.css';

function About() {
  return (
    <main>
      <h1>About</h1>
      <p>This page is a second HTML entry with its own JavaScript.</p>
      <p>
        <a href="/">Home</a>
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<About />);
