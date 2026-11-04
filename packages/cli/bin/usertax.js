#!/usr/bin/env node
import { main, nodeVersionWarning } from '../dist/index.js';

// Standard error only: standard output carries reports and the MCP protocol.
const warning = nodeVersionWarning(process.version);
if (warning !== undefined) process.stderr.write(warning);

process.exitCode = await main(process.argv.slice(2));
