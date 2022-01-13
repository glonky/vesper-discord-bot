/** @type {import('@jest/types').Config.InitialOptions} */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const baseConfig = require('../../jest.config.shared.cjs');

const config = {
  ...baseConfig,
  displayName: 'sidebar-exchange-rate-bot',
};

module.exports = config;
