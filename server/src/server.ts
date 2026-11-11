import { createServer, type Server } from 'node:http';
import type { AppConfig } from './config.js';
import { openDatabase, type AppDatabase } from './db/database.js';
import { syncHouseholdMarker } from './db/householdState.js';
import {
  checkpointDatabaseWal,
  persistenceIssueAllowsStart,
  verifyHouseholdPersistence,
} from './db/persistence.js';
import {
  appendRuntimeEvent,
  buildBootFailureReport,
  buildPersistenceRefusalReport,
  emitStartupFailure,
} from './log/startupFailure.js';
import { handleHttpRequest } from './http/handle.js';
import { sendError } from './http/respond.js';
import { alertRoutes } from './routes/alertRoutes.js';
import { authRoutes } from './routes/authRoutes.js';
import { boardRoutes } from './routes/boardRoutes.js';
import { foodRoutes } from './routes/foodRoutes.js';
import { logRoutes } from './routes/logRoutes.js';
import { mealKitRoutes } from './routes/mealKitRoutes.js';
import { mealPlanRoutes } from './routes/mealPlanRoutes.js';
import { pushRoutes } from './routes/pushRoutes.js';
import { weightRoutes } from './routes/weightRoutes.js';

export type NutritionApp = {
  server: Server;
  config: AppConfig;
  db: AppDatabase;
  routes: ReturnType<typeof authRoutes>;
};

function reportPaths(config: AppConfig) {
  return { dataDir: config.dataDir, databasePath: config.databasePath };
}

function refuseStart(config: AppConfig, report: string, eventSummary: string): never {
  emitStartupFailure(config.dataDir, report, eventSummary);
  process.exit(1);
}

export function createNutritionApp(config: AppConfig): NutritionApp {
  let db: AppDatabase;
  try {
    db = openDatabase(config.databasePath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    refuseStart(
      config,
      buildBootFailureReport(
        'Could not open the database file',
        detail,
        reportPaths(config),
      ),
      'database open failed',
    );
  }
  try {
    checkpointDatabaseWal(db, 'RESTART');
  } catch (error) {
    console.error('WAL checkpoint on startup failed', error);
    appendRuntimeEvent(config.dataDir, `WARN startup wal_checkpoint: ${error instanceof Error ? error.message : error}`);
  }
  const persistenceIssue = verifyHouseholdPersistence(db, config.dataDir);
  if (persistenceIssue && !persistenceIssueAllowsStart(persistenceIssue)) {
    const report = buildPersistenceRefusalReport(persistenceIssue, reportPaths(config));
    db.close();
    refuseStart(config, report, persistenceIssue.kind);
  }
  syncHouseholdMarker(config.dataDir, db);
  const routes = [
    ...authRoutes(),
    ...alertRoutes(),
    ...boardRoutes(),
    ...foodRoutes(),
    ...logRoutes(),
    ...mealKitRoutes(),
    ...mealPlanRoutes(),
    ...pushRoutes(),
    ...weightRoutes(),
  ];
  const server = createServer((req, res) => {
    void handleHttpRequest(req, res, { config, db, routes }).catch((error: unknown) => sendError(res, error));
  });
  return { server, config, db, routes };
}
