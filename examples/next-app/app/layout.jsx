import { GeistSans } from 'geist/font/sans';
import './globals.css';

export const metadata = {
  title: 'usertax example — Next.js',
  description: 'A small Next.js app used to test usertax measurements.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={GeistSans.className}>
      <body>
        <nav>
          <a href="/">Home</a> · <a href="/about">About</a> · <a href="/counter">Counter</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
