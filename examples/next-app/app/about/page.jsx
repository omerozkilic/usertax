import hero from '../hero.png';

export default function About() {
  return (
    <main>
      <h1>About</h1>
      <p>A static page without client components.</p>
      {/* A plain <img>: next/image optimises images per request, outside the build output. */}
      <img src={hero.src} alt="" width={hero.width} height={hero.height} />
    </main>
  );
}
