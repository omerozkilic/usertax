import { z } from 'zod';
import { budgetSchema } from './budgets.js';
import { compressionSchema, frameworkSchema, platformSchema } from './schema.js';

const noiseThreshold = z
  .object({ floor: z.number().nonnegative(), k: z.number().nonnegative() })
  .strict();

export const appConfigSchema = z
  .object({
    /** App directory relative to the repository root. */
    path: z.string().min(1),
    id: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    framework: frameworkSchema.optional(),
    /** Build output directory relative to the app (default: dist, .next for Next.js). */
    outDir: z.string().min(1).optional(),
    /** React Native bundles, relative to the app. Expo apps default to their `expo export` output. */
    bundles: z
      .array(
        z
          .object({
            platform: platformSchema,
            file: z.string().min(1),
            map: z.string().min(1).optional(),
          })
          .strict(),
      )
      .optional(),
    /** APK, AAB or IPA files, relative to the app. */
    archives: z
      .array(
        z.object({ file: z.string().min(1), key: z.string().min(1).max(200).optional() }).strict(),
      )
      .optional(),
    lighthouse: z
      .object({
        pages: z.array(z.string().startsWith('/')).min(1),
        runs: z.number().int().min(1).max(100).default(5),
        warmup: z.number().int().min(0).max(10).default(1),
        formFactor: z.enum(['mobile', 'desktop']).default('mobile'),
        baseUrl: z.url().optional(),
        startCommand: z.string().min(1).optional(),
      })
      .strict()
      .refine((l) => l.startCommand === undefined || l.baseUrl !== undefined, {
        message: 'startCommand needs baseUrl, the address the started server listens on',
      })
      .optional(),
  })
  .strict();
export type AppConfig = z.output<typeof appConfigSchema>;

/** `usertax.config.(json|ts|mjs|js)` at the repository root (ADR 0012). */
export const configSchema = z
  .object({
    $schema: z.string().optional(),
    /** Apps to measure. Without it, usertax discovers the apps of the workspace. */
    apps: z.array(appConfigSchema).min(1).optional(),
    budgets: z.array(budgetSchema).default([]),
    /**
     * Noise thresholds for Lighthouse metrics, over the calibrated defaults (ADR 0007). `null`
     * turns the assessment off for a metric.
     */
    noise: z
      .object({
        performance: noiseThreshold.nullable().optional(),
        lcp: noiseThreshold.nullable().optional(),
        tbt: noiseThreshold.nullable().optional(),
        cls: noiseThreshold.nullable().optional(),
      })
      .strict()
      .optional(),
    /** Size shown for web assets in the comment. */
    compression: compressionSchema.default('gzip'),
    /** Files, packages and archive entries listed per app. */
    top: z.number().int().min(0).max(1000).default(10),
  })
  .strict();
export type Config = z.output<typeof configSchema>;
export type ConfigInput = z.input<typeof configSchema>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Validates a configuration object. Throws {@link ConfigError} with readable issues. */
export function parseConfig(input: unknown, source = 'configuration'): Config {
  const result = configSchema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues
    .slice(0, 20)
    .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '(root)'}: ${issue.message}`);
  throw new ConfigError(`invalid ${source}:\n- ${issues.join('\n- ')}`);
}

/** JSON Schema of the configuration file, for editors. */
export function configJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(configSchema, { target: 'draft-2020-12', io: 'input' });
}
