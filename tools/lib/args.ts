/** `--name value` options from the command line; a flag without a value (followed by another `--` option or nothing) maps to "". */
export function parseArgs(argv = process.argv.slice(2)): Map<string, string> {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    args.set(argv[i].slice(2), next && !next.startsWith("--") ? argv[++i] : "");
  }
  return args;
}
