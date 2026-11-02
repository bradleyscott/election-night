import type { ReactNode } from 'react';
import {
  CountedBar,
  LeadLine,
  PartyBars,
  PartyLegend,
  SpecialsFan,
  SpreadFan,
} from './WinPercentFigures.js';

/**
 * The body of the Win % explainer, drawn inside `WinPercentDrawer`.
 *
 * The figures are a worked example with round numbers, never live data, and the
 * drawer says so before the first number appears. That is deliberate: the
 * generic entry point is a table header with dozens of seats behind it, so
 * there is no single seat whose counts could be used. A reader who wants the
 * method applied to real counts opens an electorate, where the same numbers are
 * computed from its own votes. The model itself is in
 * `packages/core/src/seat-probability.ts`; the measurement behind the
 * special-vote spread is in `docs/seat-probability-model.md` §4.
 */

const PRIOR = [
  { party: 'National Party', share: 46.3 },
  { party: 'Labour Party', share: 34.3 },
  { party: 'others', share: 19.4 },
];

const TONIGHT = [
  { party: 'National Party', share: 42.4 },
  { party: 'Labour Party', share: 40.4 },
  { party: 'others', share: 17.2 },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <div className="kicker">{title}</div>
      <div className="mt-2 border-t">{children}</div>
    </section>
  );
}

function Step({
  n,
  title,
  figure,
  children,
}: {
  n: string;
  title: string;
  figure: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[24px_1fr] gap-x-4 gap-y-3 border-b py-5 last:border-b-0 lg:grid-cols-[24px_1fr_300px] lg:items-start">
      <span className="pt-1 font-mono text-xs text-muted-foreground">{n}</span>
      <div>
        <h3 className="font-display text-[19px] font-bold leading-tight">
          {title}
        </h3>
        <div className="mt-1.5 max-w-[46ch] space-y-2 text-[14.5px] leading-relaxed text-muted-foreground">
          {children}
        </div>
      </div>
      <div className="col-span-2 lg:col-span-1 lg:self-center">{figure}</div>
    </div>
  );
}

export function WinPercentContent() {
  return (
    <div>
      <p className="max-w-[62ch] text-[16px] leading-relaxed">
        Win % is our best estimate of who wins an electorate once every vote is
        counted: the votes counted tonight, the votes still to come, and the
        special votes counted over the two weeks after election night.
      </p>

      <div className="mt-4 border px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="chip-print">Worked example</span>
          <span className="font-label text-[11px] text-muted-foreground">
            Not tonight's results
          </span>
        </div>
        <p className="mt-1.5 max-w-[62ch] text-[13.5px] leading-relaxed text-muted-foreground">
          The numbers below are round figures chosen to keep the arithmetic
          simple. Every electorate page applies the same method to its own
          counts, so open one to see the real numbers.
        </p>
      </div>

      <Section title="What goes in">
        <Step
          n="1"
          title="How many votes are left"
          figure={
            <div>
              <CountedBar counted={68} />
              <div className="mt-1.5 flex justify-between font-mono text-[11px] tabular-nums">
                <span>19,846 in</span>
                <span className="text-muted-foreground">≈9,300 out</span>
              </div>
              <div className="mt-1 flex justify-between font-label text-[10px] text-muted-foreground">
                <span>68% counted</span>
                <span>rest of tonight</span>
              </div>
            </div>
          }
        >
          <p>
            The Electoral Commission does not publish an electorate's final
            total until every vote has been counted, so it has to be estimated.
            Enrolment in the electorate, and the turnout there last time, give
            the likely size of the vote; subtract what is already counted and
            the rest is still to come.
          </p>
          <p>
            Both figures are only a guide. A roll that has grown, or unusual
            turnout, can make the estimate wrong in either direction, so the
            estimate is checked against the booths. If most of an electorate's
            booths are still to report, the electorate is far from finished.
          </p>
        </Step>

        <Step
          n="2"
          title="Where the rest of them are heading"
          figure={
            <div>
              <PartyBars prior={PRIOR} tonight={TONIGHT} />
              <PartyLegend
                parties={[
                  { party: 'National Party', label: 'National' },
                  { party: 'Labour Party', label: 'Labour' },
                  { party: 'others', label: 'others' },
                ]}
              />
              <div className="mt-1 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                swing +5 to Labour
              </div>
            </div>
          }
        >
          <p>
            The starting point is this electorate's own result last time, the
            only complete picture of how the electorate votes. Tonight's results
            then move it: in the electorates counted so far the vote has swung
            five points to Labour, and that swing is applied to this
            electorate's last result. What comes out is the shape the remaining
            votes are expected to take.
          </p>
          <p>
            Early in the evening we lean on tonight's swing less: the first
            votes counted are advance votes, and the booths that report first
            are not a random sample of the electorate. Neither is a reliable
            guide to how the electorate's election-day votes will split.
          </p>
        </Step>
      </Section>

      <Section title="How those become one number">
        <Step
          n="1"
          title="The expected result"
          figure={<LeadLine priorLead={12} expectedLead={2} />}
        >
          <p>
            Adding the expected remaining votes to the votes already counted
            gives one expected result. In the example that is a National lead of
            about 2: National won by 12 last time, and a five-point swing to
            Labour takes 10 points off a lead between two parties.
          </p>
        </Step>

        <Step
          n="2"
          title="How far it could still move"
          figure={
            <div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <SpreadFan
                    mean={2}
                    sd={26}
                    from={-60}
                    to={60}
                    width={158}
                    height={84}
                    label="A wide range of plausible results with a fifth of the votes counted"
                  />
                  <div className="mt-1 text-center font-label text-[9.5px] text-muted-foreground">
                    a fifth counted
                  </div>
                </div>
                <div>
                  <SpreadFan
                    mean={2}
                    sd={7}
                    from={-60}
                    to={60}
                    width={158}
                    height={84}
                    label="A narrow range of plausible results with four fifths of the votes counted"
                  />
                  <div className="mt-1 text-center font-label text-[9.5px] text-muted-foreground">
                    four fifths counted
                  </div>
                </div>
              </div>
              <div className="mt-1.5 text-center font-mono text-[10px] text-muted-foreground">
                same electorate, same lead
              </div>
            </div>
          }
        >
          <p>
            The model keeps every result that is still plausible, weighted by
            how likely it is. That collection is the spread. It is wide when a
            lot is still to count, when the race is close, and when last time's
            result is a weak guide to the electorate. It narrows as the votes
            come in.
          </p>
        </Step>

        <Step
          n="3"
          title="Turning the spread into Win %"
          figure={
            <div>
              <SpreadFan
                mean={2}
                sd={20}
                width={300}
                height={104}
                label="The plausible range of results, 54% of it on National's side of a tie and 46% on Labour's"
              />
              <div className="mt-1 flex justify-between font-label text-[10px] text-muted-foreground">
                <span>Labour ahead</span>
                <span>tie</span>
                <span>National ahead</span>
              </div>
              <div className="mt-1 grid grid-cols-2 font-mono text-[11px] tabular-nums">
                <div className="border-r pr-2 text-right text-muted-foreground">
                  46% of the spread
                </div>
                <div className="pl-2">54% of the spread</div>
              </div>
            </div>
          }
        >
          <p>
            Win % is the share of the spread in which a candidate finishes
            ahead. In the example 54% of it is on National's side of a tie and
            46% on Labour's, so National's Win % is 54.
          </p>
        </Step>

        <Step
          n="4"
          title="Adding the special votes"
          figure={
            <div>
              <SpecialsFan width={300} height={112} />
              <p className="mt-1 font-label text-[9.5px] leading-snug text-muted-foreground">
                The red tail is the{' '}
                <span className="font-semibold text-foreground">
                  34 cases in 100
                </span>{' '}
                where the special votes shift far enough to overturn the lead.
              </p>
              <div className="mt-2 flex items-baseline justify-between border-t pt-2">
                <span className="font-label text-[10.5px] text-muted-foreground">
                  lead survives
                </span>
                <span className="font-display text-[22px] font-bold leading-none tabular-nums">
                  66<span className="text-[12px]">%</span>
                </span>
              </div>
            </div>
          }
        >
          <p>
            About one vote in five is a special vote: one cast from overseas, or
            one cast outside the voter's own electorate. They are counted after
            election night and added to each candidate's total from that night,
            so they change the lead only if they split differently from the
            votes counted on election night. The lead in the example is 393
            votes against about 9,700 special votes, so the special vote would
            have to favour Labour by four points more than the election-night
            count did to overturn it.
          </p>
          <p>
            The model lets the special vote's lean run either way, with a
            ten-point spread: about three times the swing a typical seat showed
            in the last three elections. Half of that spread leans towards the
            leader, which keeps the electorate; in the other half, only shifts
            of more than four points overturn the lead. That leaves the lead
            surviving in 66 cases out of 100.
          </p>
          <p>
            Once the ordinary count is finished, every ordinary vote is in but
            the special votes can still change the winner. From that point Win %
            is this figure: the chance the lead survives the special votes.
          </p>
        </Step>
      </Section>
    </div>
  );
}
