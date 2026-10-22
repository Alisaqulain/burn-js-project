// Test fixture: prints one line, then never exits on its own.
process.stdout.write('{"type":"progress","phase":"warmup","iteration":1,"total":1}\n');
setInterval(() => {}, 1_000);
export {};
