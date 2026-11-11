import { loadConfig } from './config.js';
import { readAutoBackupIntervalHours, scheduleDatabaseBackups } from './db/backup.js';
import { readWalCheckpointIntervalMinutes, scheduleWalCheckpoints } from './db/persistence.js';
import { appendRuntimeEvent, buildBootFailureReport, emitStartupFailure } from './log/startupFailure.js';
import { createNutritionApp } from './server.js';

const config = loadConfig();

function logProcessFailure(label: string, error: unknown): never {
  const detail = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ''}` : String(error);
  const report = buildBootFailureReport(label, detail, {
    dataDir: config.dataDir,
    databasePath: config.databasePath,
  });
  emitStartupFailure(config.dataDir, report, label);
  process.exit(1);
}

process.on('uncaughtException', (error) => {
  logProcessFailure('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  logProcessFailure('unhandledRejection', reason);
});

const app = createNutritionApp(config);

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Shutting down (${signal})…`);
  appendRuntimeEvent(config.dataDir, `shutdown ${signal}`);
  app.server.close(() => {
    try {
      app.db.pragma('wal_checkpoint(TRUNCATE)');
    } catch (error) {
      console.error('WAL checkpoint on shutdown failed', error);
    }
    app.db.close();
    process.exit(0);
  });
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

app.server.listen(config.port, '0.0.0.0', () => {
  const walMinutes = readWalCheckpointIntervalMinutes();
  if (walMinutes > 0) {
    scheduleWalCheckpoints(app.db, walMinutes);
  }
  const backupHours = readAutoBackupIntervalHours();
  if (backupHours > 0) {
    scheduleDatabaseBackups(app.db, config.dataDir, backupHours, (line) => appendRuntimeEvent(config.dataDir, line));
  }
  appendRuntimeEvent(config.dataDir, `listening port=${config.port} wal_min=${walMinutes} backup_h=${backupHours}`);
  console.log(`Nutrition Tracker listening on ${config.port}`);
});
