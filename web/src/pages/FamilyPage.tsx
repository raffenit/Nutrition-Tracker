import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import { DateBar } from '../components/DateBar';
import { DayLog } from '../components/DayLog';
import { FamilySummary, memberMonthGoalLine, memberUsualMealsLine } from '../components/FamilySummary';
import { MemberDaySummary } from '../components/MemberDaySummary';
import type { FamilyMemberInsights } from '../components/FamilySummary';
import type { DateFormat } from '../dateFormat';
import type { DayTotals, MealLog, Targets, User } from '../types';
import type { Units } from '../units';

type Family = {
  date: string;
  today: string;
  householdName: string;
  dateFormat: DateFormat;
  members: Array<{
    user: User;
    units: Units;
    targets: Pick<Targets, 'calories' | 'protein' | 'fiber' | 'hydrationMl' | 'units'>;
    totals: DayTotals;
    logs: MealLog[];
    insights: FamilyMemberInsights;
  }>;
};

export function FamilyPage({ kiosk }: { kiosk: boolean }) {
  return (
    <div className="page family-page home-page">
      <FamilyBoard kiosk={kiosk} datePath="/family" />
    </div>
  );
}

/** Last fetched board per date param — keeps Me/Family toggles instant. */
let familyCache: { key: string; board: Family } | null = null;

/** Family board content — also embedded as the home screen's Family mode. */
export function FamilyBoard({ kiosk, datePath, query, leading }: { kiosk: boolean; datePath: string; query?: string; leading?: ReactNode }) {
  const date = new URLSearchParams(window.location.search).get('date');
  const cacheKey = date ?? '';
  const [board, setBoard] = useState<Family | null>(() =>
    familyCache?.key === cacheKey ? familyCache.board : null,
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const cached = familyCache?.key === cacheKey ? familyCache.board : null;
    if (cached) setBoard(cached);
    setError(null);
    let cancelled = false;
    void api<Family>(`/api/family${date ? `?date=${date}` : ''}`)
      .then((next) => {
        familyCache = { key: cacheKey, board: next };
        if (!cancelled) setBoard(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load family');
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, date]);
  if (!board) {
    return error ? <p className="notice">{error}</p> : <p>Loading the household…</p>;
  }

  const monthLabel =
    board.members.find((member) => member.insights.goalDays.monthLabel)?.insights.goalDays.monthLabel
    ?? formatMonthLabel(board.date);

  return (
    <>
      <div className="page-layout-span stack">
        <h1 className="page-title">{familyPageTitle(board.householdName, monthLabel)}</h1>
        <DateBar path={datePath} query={query} leading={leading} date={board.date} today={board.today} dateFormat={board.dateFormat} />
      </div>
      <FamilySummary members={board.members} />
      <div className="grid family-member-grid">
        {board.members.map((member) => {
          const usualMeals = memberUsualMealsLine(member);
          return (
            <section className="card family-member-card" key={member.user.id}>
              <h2>{member.user.name}</h2>
              <MemberDaySummary totals={member.totals} targets={member.targets} units={member.units} />
              <p className="family-member-month muted">{memberMonthGoalLine(member)}</p>
              {usualMeals ? (
                <p className="family-member-meals muted">Usual times: {usualMeals}</p>
              ) : (
                <p className="family-member-meals muted">No meal logs yet this month.</p>
              )}
              <DayLog logs={member.logs} isToday={board.date === board.today} />
            </section>
          );
        })}
      </div>
      {kiosk && <p className="muted family-kiosk-note">Family board — weight and personal settings stay private.</p>}
    </>
  );
}

function familyPageTitle(householdName: string, monthLabel: string): string {
  const base = /\bfamily\b/i.test(householdName) ? householdName : `${householdName} Family`;
  return `${base} – ${monthLabel}`;
}

function formatMonthLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}
