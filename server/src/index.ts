import { loadConfig } from './config.js';
import { createNutritionApp } from './server.js';

const config = loadConfig();
const { server } = createNutritionApp(config);

server.listen(config.port, '0.0.0.0', () => {
  console.log(`Nutrition Tracker listening on ${config.port}`);
});
