import { arch, platform, release } from 'node:os';
import { REPORT_SCHEMA_VERSION, parseReport } from '@usertax/core';
import type { App, Report } from '@usertax/core';
import { COMPRESSION_SETTINGS } from './compressed-size.js';

export interface CreateReportOptions {
  readonly apps: readonly App[];
  readonly toolVersion: string;
  readonly sha?: string;
  readonly ref?: string;
  /** Defaults to now. */
  readonly createdAt?: Date;
}

/** Assembles and validates a report. */
export function createReport(options: CreateReportOptions): Report {
  return parseReport({
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: { name: 'usertax', version: options.toolVersion },
    createdAt: (options.createdAt ?? new Date()).toISOString(),
    ...(options.sha === undefined
      ? {}
      : { git: { sha: options.sha, ...(options.ref === undefined ? {} : { ref: options.ref }) } }),
    settings: { compression: { ...COMPRESSION_SETTINGS } },
    environment: { os: `${platform()} ${release()} ${arch()}`, node: process.version },
    apps: options.apps,
  });
}
