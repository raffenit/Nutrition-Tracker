import assert from 'node:assert/strict';
import test from 'node:test';
import { openDatabase } from '../db/database.js';
import { alertAlreadyPushed, markAlertPushed } from '../db/push.js';
import { shouldPushAlert } from './pushNotify.js';

test('shouldPushAlert sends hard alerts once and allows soft alerts', () => {
  const db = openDatabase(':memory:');
  db.pragma('foreign_keys = OFF');
  const userId = 'user-1';
  const date = '2026-09-29';
  const hard = { id: 'calories-hard', tone: 'danger' as const, message: 'over', dismissible: false };
  const soft = { id: 'calories-soft', tone: 'warn' as const, message: 'near', dismissible: true };
  assert.equal(shouldPushAlert(db, userId, date, hard), true);
  markAlertPushed(db, userId, date, hard.id);
  assert.equal(shouldPushAlert(db, userId, date, hard), false);
  assert.equal(alertAlreadyPushed(db, userId, date, hard.id), true);
  assert.equal(shouldPushAlert(db, userId, date, soft), true);
});
