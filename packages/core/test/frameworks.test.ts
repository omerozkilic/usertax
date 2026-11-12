import { describe, expect, it } from 'vitest';
import { diffReports, parseReport, renderMarkdown } from '@usertax/core';
import { report, webApp } from './fixtures.js';

describe.each([
  ['react-router', 'React Router'],
  ['nuxt', 'Nuxt'],
  ['astro', 'Astro'],
  ['sveltekit', 'SvelteKit'],
] as const)('a %s app', (framework, label) => {
  it('is a valid report and is named in the comment', () => {
    const input = report([webApp({ framework })]);
    expect(parseReport(JSON.parse(JSON.stringify(input))).apps[0]?.framework).toBe(framework);
    expect(renderMarkdown(diffReports(input))).toContain(`<sub>${label} ·`);
  });
});
