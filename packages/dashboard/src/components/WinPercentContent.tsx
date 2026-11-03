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
 * The figures are a worked example with round numbers, never live data, and
 * every one of them is tagged `Example` on the drawing itself. That is
 * deliberate: the generic entry point is a table header with dozens of seats
 * behind it, so there is no single seat whose counts could be used, and a caveat
 * at the top of the drawer was scrolled past long before the first figure
 * appeared. A reader who wants the method applied to real counts opens an
 * electorate, where the same numbers are computed from its own votes. The model
 * itself is in `packages/core/src/seat-probability.ts`; the measurement behind
 * the special-vote spread is in `docs/seat-probability-model.md` §4.
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

/**
 * One step of the method: the number, the claim, the drawing, and the prose.
 *
 * The drawing follows the heading on a phone, before anything is read: it is the
 * shortest statement of the step and the prose explains it. On a wide panel
 * there is a third column for it, level with the prose it illustrates.
 */
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
      <span className="pt-1 font-mono text-xs text-muted-foreground lg:col-start-1 lg:row-start-1">
        {n}
      </span>
      <h3 className="font-display text-[19px] font-bold leading-tight lg:col-start-2 lg:row-start-1">
        {title}
      </h3>
      <div className="col-span-2 lg:col-span-1 lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-center">
        {/* The figures are a worked example, never tonight's counts, so each
            one carries its own mark rather than a notice at the top of the
            drawer that a reader has scrolled past by the time it matters. */}
        <div className="mb-1.5 flex justify-end">
          <span className="chip-print">Example</span>
        </div>
        {figure}
      </div>
      <div className="col-span-2 max-w-[46ch] space-y-2 text-[14.5px] leading-relaxed text-muted-foreground lg:col-span-1 lg:col-start-2 lg:row-start-2">
        {children}
      </div>
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
        </Step>

        <Step
          n="2"
          title="Who the remaining votes will favour"
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
            The starting point is this electorate's own result last time, which
            tonight's results then move: in the electorates counted so far the
            vote has swung five points to Labour, and that swing is applied to
            this electorate's last result. What comes out is the shape the
            remaining votes are expected to take.
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
            gives an estimated final vote count. In the example that count puts
            National ahead by about 2: National won by 12 last time, and a
            five-point swing to Labour takes 10 points off a lead between two
            parties.
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
            Special votes can change the lead if they split differently from the
            votes counted on election night. The lead in the example is 393
            votes compared to an expected 9,700 special votes, so the special
            vote would have to favour Labour by four points more than the
            election-night count did to overturn it.
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
            Win % is this figure: the chance the lead survives the special
            votes.
          </p>
        </Step>
      </Section>
    </div>
  );
}
