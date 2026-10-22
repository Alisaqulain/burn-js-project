// Test fixture: echoes stdin back as two lines, writes to stderr, exits with code 7.
const input = await Bun.stdin.text();
process.stdout.write(`line1:${input}\nline2\n`);
process.stderr.write("diagnostic message\n");
process.exitCode = 7;
export {};
