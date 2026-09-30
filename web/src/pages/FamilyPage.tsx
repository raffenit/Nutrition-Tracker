import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { DateBar } from '../components/DateBar';
import { DayLog } from '../components/DayLog';
import { formatVolume, type Units } from '../units';
import type { DayTotals, MealLog, User } from '../types';

type Family = {
  date: string;
  today: string;
  householdName: string;
  members: Array<{ user: User; units: Units; totals: DayTotals; logs: MealLog[] }>;
};

export function FamilyPage({ kiosk }: { kiosk: boolean }) {
  const [board, setBoard] = useState<Family | null>(null);
  const date = new URLSearchParams(window.location.search).get('date');
  useEffect(() => {
    void api<Family>(`/api/family${date ? `?date=${date}` : ''}`).then(setBoard);
  }, [date]);
  if (!board) return <p>Loading the household…</p>;
  return (
    <div className="page">
      <h1>{board.householdName}</h1>
      {!kiosk && <DateBar path="/family" date={board.date} today={board.today} />}
      <div className="grid">
        {board.members.map((member) => (
          <section className="card" key={member.user.id}>
            <h2>{member.user.name}</h2>
            <p>{Math.round(member.totals.calories)} kcal · {Math.round(member.totals.protein)} g protein · {formatVolume(member.totals.hydrationMl, member.units)}</p>
            <DayLog logs={member.logs} />
          </section>
        ))}
      </div>
    </div>
  );
}
