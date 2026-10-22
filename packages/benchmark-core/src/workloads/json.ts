import type { JsonParams } from "@bunbench/shared";
import { FNV_OFFSET, fnv1aInt, fnv1aString, toHex } from "../hash.ts";
import { createPrng, randomInt } from "../prng.ts";
import type { PreparedWorkload } from "./types.ts";

const WORDS = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliett", "kilo", "lima"];
const CITIES = ["Zürich", "São Paulo", "Kraków", "Hyderabad", "Reykjavík", "Nairobi", "Montréal", "Ōsaka"];

export interface JsonRecord {
  id: number;
  name: string;
  active: boolean;
  score: number;
  tags: string[];
  address: { street: string; city: string; zip: string };
  history: number[];
  note: string | null;
}

/** Deterministic dataset; scores are integers / 100 so number formatting is unambiguous. */
export function generateJsonRecords(count: number, seed: number): JsonRecord[] {
  const next = createPrng(seed);
  const records: JsonRecord[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const history: number[] = [];
    for (let h = 0; h < 5; h++) history.push(randomInt(next, 10_000));
    records[i] = {
      id: i,
      name: `${WORDS[randomInt(next, WORDS.length)]}-${WORDS[randomInt(next, WORDS.length)]}-${i}`,
      active: next() < 0.5,
      score: randomInt(next, 1_000_000) / 100,
      tags: [WORDS[randomInt(next, WORDS.length)]!, WORDS[randomInt(next, WORDS.length)]!, `t${randomInt(next, 100)}`],
      address: {
        street: `${randomInt(next, 9_999)} ${WORDS[randomInt(next, WORDS.length)]} street "quoted"`,
        city: CITIES[randomInt(next, CITIES.length)]!,
        zip: String(10_000 + randomInt(next, 89_999)),
      },
      history,
      note: next() < 0.2 ? null : `line1\nline2\ttab \\ backslash ${i}`,
    };
  }
  return records;
}

export function prepareJson(params: JsonParams, seed: number): PreparedWorkload {
  const data = generateJsonRecords(params.records, seed);
  const inputChecksum = toHex(fnv1aString(JSON.stringify(data)));
  return {
    opsUnit: "records",
    opsPerRun: params.records,
    inputChecksum,
    run() {
      const text = JSON.stringify(data);
      const parsed = JSON.parse(text) as JsonRecord[];
      let hash = fnv1aInt(FNV_OFFSET, text.length);
      for (let i = 0; i < parsed.length; i++) {
        const r = parsed[i]!;
        hash = fnv1aInt(hash, r.id);
        hash = fnv1aInt(hash, Math.round(r.score * 100));
        hash = fnv1aInt(hash, r.history[4]!);
        hash = fnv1aInt(hash, r.address.city.length);
      }
      return toHex(hash);
    },
  };
}
