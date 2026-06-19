import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'csv-parse/sync';
import type { PartyList } from '@election-night/core/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

export type CsvData = {
  candidateRecords: Record<string, string>[];
  partyListRecords: PartyList[];
  electorateNames: string[];
  partyMap: Record<string, string | undefined>;
};

export function loadCandidateRecords(): Record<string, string>[] {
  const csv = readFileSync(
    resolve(__dirname, '../../../csv/candidates.csv'),
    'utf-8'
  );
  return parse(csv, { columns: true }) as Record<string, string>[];
}

export function loadPartyListRecords(): PartyList[] {
  const csv = readFileSync(
    resolve(__dirname, '../../../csv/party_list.csv'),
    'utf-8'
  );
  return parse(csv, { columns: true }).map(
    (x: Record<string, string>) => ({
      party: x.Party,
      candidate: `${x['Ballot Last Name']}, ${x['Ballot First Name']}`,
      listRank: Number(x['List No.']),
    })
  );
}

export function loadElectorateNames(): string[] {
  const csv = readFileSync(
    resolve(__dirname, '../../../csv/electorates.csv'),
    'utf-8'
  );
  return csv
    .trim()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildPartyMap(
  candidateRecords: Record<string, string>[]
): Record<string, string | undefined> {
  const map: Record<string, string | undefined> = {};
  for (const row of candidateRecords) {
    map[row.Name] = row.Party;
  }
  return map;
}

export function loadCsvData(): CsvData {
  const candidateRecords = loadCandidateRecords();
  const partyListRecords = loadPartyListRecords();
  const electorateNames = loadElectorateNames();
  const partyMap = buildPartyMap(candidateRecords);
  return { candidateRecords, partyListRecords, electorateNames, partyMap };
}
