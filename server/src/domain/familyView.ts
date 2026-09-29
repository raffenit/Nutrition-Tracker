import type { DayTotals, HydrationEntry, MealLog, UserPublic } from '../types.js';

export type FamilyMember = {
  user: UserPublic;
  totals: DayTotals;
  logs: MealLog[];
  hydration: HydrationEntry[];
};

export type FamilyBoard = {
  date: string;
  today: string;
  householdName: string;
  members: FamilyMember[];
};

type MemberSource = FamilyMember & {
  weight?: unknown;
};

export function toFamilyBoard(input: {
  date: string;
  today: string;
  householdName: string;
  members: MemberSource[];
}): FamilyBoard {
  const board = {
    date: input.date,
    today: input.today,
    householdName: input.householdName,
    members: input.members.map(toFamilyMember),
  };
  assertFamilyBoardIsPublic(board);
  return board;
}

export function assertFamilyBoardIsPublic(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertFamilyBoardIsPublic);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (/weight/i.test(key)) throw new Error('Family view cannot include weight');
    assertFamilyBoardIsPublic(child);
  }
}

function toFamilyMember(source: MemberSource): FamilyMember {
  return {
    user: { id: source.user.id, name: source.user.name, role: source.user.role },
    totals: source.totals,
    logs: source.logs,
    hydration: source.hydration,
  };
}
