import { describe, expect, test } from 'vitest';
import { NzElectionResultsSource } from '@election-night/core/sources/nz-election-results';
import type { ElectorateConfig } from '@election-night/core/types';
import { html } from './fixtures';
import { isCloudflareChallenge } from './scraper.js';

const config: ElectorateConfig = {
  electorateName: 'Auckland Central',
  url: 'https://electionresults.govt.nz/electionresults_2023/electorate-details-01.html',
};

const source = new NzElectionResultsSource({
  electorateNames: ['Auckland Central'],
});

describe('isCloudflareChallenge', () => {
  test('detects the managed challenge page', () => {
    const challengeHtml =
      '<html><head><title>Just a moment...</title></head><body><div class="cf-chl-widget"></div><script>challenge-platform</script></body></html>';
    expect(isCloudflareChallenge(challengeHtml, 'https://x.example/')).toBe(
      true
    );
  });

  test('detects the attention-required block page', () => {
    const blockHtml =
      '<html><title>Attention Required! | Cloudflare</title><body>This website is using a security service to protect itself from online attacks.</body></html>';
    expect(isCloudflareChallenge(blockHtml, 'https://x.example/')).toBe(true);
  });

  test('detects a challenged URL even with innocuous html', () => {
    expect(
      isCloudflareChallenge(
        '<html>skeleton</html>',
        'https://x.example/?__cf_chl_rt_tk=abc123'
      )
    ).toBe(true);
  });

  test('does not flag a real results page', () => {
    expect(isCloudflareChallenge(html, config.url)).toBe(false);
  });
});

describe('NzElectionResultsSource', () => {
  test('parseRawResults extracts candidate votes without party', () => {
    const raw = source.parseRawResults(html, config);
    const expected = [
      { candidate: 'DELAMERE, Tuariki', votes: 320 },
      { candidate: 'HOFFMAN DERVAN, Dominic', votes: 50 },
      { candidate: 'LOVE, Joshua', votes: 73 },
      { candidate: 'MARCROFT, Jenny', votes: 274 },
      { candidate: 'MELLOW, Emma', votes: 9775 },
      { candidate: 'POOLE, Felix', votes: 588 },
      { candidate: 'SADLER, Chris', votes: 23 },
      { candidate: 'STITT, Kevin', votes: 186 },
      { candidate: 'SWARBRICK, Chlöe', votes: 12631 },
      { candidate: 'TAVA, Vernon', votes: 120 },
      { candidate: 'WHITE, Helen', votes: 11563 },
    ];
    expect(raw.candidateVotes).toEqual(expected);
  });

  test('parseRawResults extracts party votes', () => {
    const raw = source.parseRawResults(html, config);
    const expected = [
      { candidate: 'The Opportunities Party (TOP)', votes: 776 },
      { candidate: 'TEA Party', votes: 35 },
      { candidate: 'New Zealand First Party', votes: 622 },
      { candidate: 'National Party', votes: 7680 },
      { candidate: 'ACT New Zealand', votes: 2724 },
      { candidate: 'New Conservative', votes: 197 },
      { candidate: 'Green Party', votes: 6937 },
      { candidate: 'Sustainable New Zealand Party', votes: 59 },
      { candidate: 'Labour Party', votes: 16751 },
      { candidate: 'Advance NZ', votes: 198 },
      { candidate: 'Aotearoa Legalise Cannabis Party', votes: 99 },
      { candidate: 'HeartlandNZ', votes: 1 },
      { candidate: 'Te Pāti Māori', votes: 111 },
      { candidate: 'NZ Outdoors Party', votes: 15 },
      { candidate: 'ONE Party', votes: 20 },
      { candidate: 'Social Credit', votes: 7 },
      { candidate: 'Vision New Zealand', votes: 11 },
    ];
    expect(raw.partyVotes).toEqual(expected);
  });

  test('party resolution is applied in pipeline', () => {
    const raw = source.parseRawResults(html, config);
    const partyMap: Record<string, string | undefined> = {
      'SWARBRICK, Chlöe': 'Green Party',
    };
    const withParty = raw.candidateVotes.map((cv) => ({
      ...cv,
      party: partyMap[cv.candidate],
    }));

    expect(
      withParty.find((c) => c.candidate === 'SWARBRICK, Chlöe')?.party
    ).toBe('Green Party');
    expect(
      withParty.find((c) => c.candidate === 'DELAMERE, Tuariki')?.party
    ).toBeUndefined();
  });
});
