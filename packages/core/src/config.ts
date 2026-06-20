import { Config } from './types.js';

export const config: Config = {
  predictionConfidence: 0.95,
  cachePaths: {
    electoralResults: '.data/electorate_results.json',
  },
  webhookUrl: undefined,
};
