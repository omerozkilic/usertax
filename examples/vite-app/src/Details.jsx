const facts = [
  'Sizes are measured from the build output, not estimated.',
  'Bytes are attributed to packages through source maps.',
  'Compressed sizes use gzip level 9 and brotli quality 11.',
];

export default function Details() {
  return (
    <ul>
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}
