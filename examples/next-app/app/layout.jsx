export const metadata = {
  title: 'usertax example — Next.js',
  description: 'A small Next.js app used to test usertax measurements.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '40rem', margin: '2rem auto', padding: '0 1rem' }}>
        <nav>
          <a href="/">Home</a> · <a href="/about">About</a> · <a href="/counter">Counter</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
