import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DateBar } from '../components/DateBar';
import { DayLog } from '../components/DayLog';
import { FamilySummary } from '../components/FamilySummary';
import { MemberDaySummary } from '../components/MemberDaySummary';
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
  }>;
};

export function FamilyPage({ kiosk }: { kiosk: boolean }) {
  const [board, setBoard] = useState<Family | null>(null);
  const date = new URLSearchParams(window.location.search).get('date');
  useEffect(() => {
    void api<Family>(`/api/family${date ? `?date=${date}` : ''}`).then(setBoard);
  }, [date]);
  if (!board) return <p>Loading the household…</p>;

  const displayUnits = board.members[0]?.units ?? 'imperial';

  return (
    <div className="page">
      <DateBar path="/family" date={board.date} today={board.today} dateFormat={board.dateFormat} />
      <h1 className="page-title">{board.householdName}</h1>
      <FamilySummary members={board.members} displayUnits={displayUnits} />
      <div className="grid">
        {board.members.map((member) => (
          <section className="card" key={member.user.id}>
            <h2>{member.user.name}</h2>
            <MemberDaySummary totals={member.totals} targets={member.targets} units={member.units} />
            <DayLog logs={member.logs} />
          </section>
        ))}
      </div>
      {kiosk && <p className="muted family-kiosk-note">Family board — weight and personal settings stay private.</p>}
    </div>
  );
}
