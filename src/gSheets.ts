import * as sheets from 'google-spreadsheet';
import { config } from './config.js';
import {
  ElectorateResults,
  PartyList,
  VotingResults,
  WithAdjustedRank,
  WithLeaders,
  WithPercentages,
  WithSeats,
} from './types';

async function getAuthenticatedDocument(): Promise<sheets.GoogleSpreadsheet> {
  const { sheetId, credentials } = config.googleSheets;
  const doc = new sheets.GoogleSpreadsheet(sheetId, credentials);
  await doc.loadInfo();
  return doc;
}

async function writeToSheet(
  sheetName: string,
  headerRow: string[],
  values: string[][]
) {
  const doc = await getAuthenticatedDocument();
  let sheet = doc.sheetsByTitle[sheetName];
  if (!sheet) {
    sheet = await doc.addSheet({ title: sheetName });
  }
  await sheet.clear();

  await sheet.resize({
    rowCount: values.length + 1,
    columnCount: headerRow.length,
  });

  await sheet.setHeaderRow(headerRow);
  await sheet.addRows(values);
}

export async function writeElectorateResultsSummary(
  results: (ElectorateResults & WithPercentages & WithLeaders)[]
) {
  const header = [
    'Electorate',
    'Votes counted',
    'Votes cast',
    'Vote % Counted',
    'Leading Candidate',
    'Leading candidate party',
    'Predicted winner',
    'Margin',
    'Margin %',
    'Second candidate',
    'Second candidate party',
    'Margin of error',
  ];
  const values = results.map((r) => [
    r.electorateName,
    r.votesCounted.toString(),
    (r.votesCounted / r.votePercentageCounted).toString(),
    r.votePercentageCounted.toString(),
    r.leaders.leadingCandidate,
    r.leaders.leadingCandidateParty,
    r.leaders.isPredictedWinner.toString(),
    r.leaders.margin.toString(),
    r.leaders.marginPercent.toString(),
    r.leaders.secondCandidate,
    r.leaders.secondCandidateParty,
    r.marginOfError.toString(),
  ]);
  await writeToSheet(
    config.googleSheets.electorateResultsSummarySheetName,
    header,
    values
  );
}

export async function writeElectorateResults(
  results: (ElectorateResults & WithPercentages & WithLeaders)[]
) {
  const header = [
    'Electorate',
    'Candidate',
    'Party',
    'Votes',
    'Is Predicted Winner',
  ];
  const values = results.flatMap((x) =>
    x.candidateVotes.map((y) => [
      x.electorateName,
      y.candidate,
      y.party,
      y.votes.toString(),
      x.leaders.isPredictedWinner && x.leaders.leadingCandidate === y.candidate
        ? 'TRUE'
        : '',
    ])
  );

  await writeToSheet(
    config.googleSheets.electorateResultsSheetName,
    header,
    values
  );
}

export async function writePartyVoteResults(
  results: (ElectorateResults & WithPercentages & WithLeaders)[]
) {
  const header = ['Electorate', 'Party', 'Votes'];
  const values = results.flatMap((x) =>
    x.partyVotes.map((y) => [x.electorateName, y.candidate, y.votes.toString()])
  );

  await writeToSheet(
    config.googleSheets.partyVoteResultsSheetName,
    header,
    values
  );
}

export async function writePartyVoteSummary(
  results: (VotingResults & WithSeats)[]
) {
  const header = ['Party', 'Votes', 'Seats', 'Electorate seats', 'List seats'];
  const values = results.map((r) => [
    r.candidate,
    r.votes.toString(),
    r.seats.toString(),
    r.electorateSeats.toString(),
    r.listSeats.toString(),
  ]);
  await writeToSheet(
    config.googleSheets.partyVoteSummarySheetName,
    header,
    values
  );
}

export async function writePartyLists(lists: (PartyList & WithAdjustedRank)[]) {
  const header = [
    'Party',
    'Candidate',
    'List Rank',
    'Adjusted Rank',
    'Distance from Cut',
  ];
  const values = lists.map((x) => [
    x.party,
    x.candidate,
    x.listRank.toString(),
    x.adjustedRank.toString(),
    x.distanceFromCut.toString(),
  ]);
  await writeToSheet(config.googleSheets.partyListsSheetName, header, values);
}
