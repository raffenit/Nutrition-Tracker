import { createServer, type Server } from 'node:http';
import type { AppConfig } from './config.js';
import { openDatabase, type AppDatabase } from './db/database.js';
import { handleHttpRequest } from './http/handle.js';
import { sendError } from './http/respond.js';
import { authRoutes } from './routes/authRoutes.js';
import { boardRoutes } from './routes/boardRoutes.js';
import { foodRoutes } from './routes/foodRoutes.js';
import { logRoutes } from './routes/logRoutes.js';
import { mealPlanRoutes } from './routes/mealPlanRoutes.js';
import { weightRoutes } from './routes/weightRoutes.js';

export type NutritionApp = {
  server: Server;
  config: AppConfig;
  db: AppDatabase;
  routes: ReturnType<typeof authRoutes>;
};

export function createNutritionApp(config: AppConfig): NutritionApp {
  const db = openDatabase(config.databasePath);
  const routes = [...authRoutes(), ...boardRoutes(), ...foodRoutes(), ...logRoutes(), ...mealPlanRoutes(), ...weightRoutes()];
  const server = createServer((req, res) => {
    void handleHttpRequest(req, res, { config, db, routes }).catch((error: unknown) => sendError(res, error));
  });
  return { server, config, db, routes };
}
