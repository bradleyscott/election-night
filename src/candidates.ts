import { readFileSync } from "fs";

export const candidatesCsv = () => readFileSync('csv/candidates.csv');
export const partyListCsv = () => readFileSync('csv/party_list.csv');