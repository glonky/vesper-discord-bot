/* eslint-disable @typescript-eslint/no-var-requires */
require('reflect-metadata');
const { Container } = require('typedi')
const { RedisService } = require('@vesper-discord/redis-service/src')
const { BaseConfig } = require('@vesper-discord/config/src/base-config');

module.exports = async () => {
  // NOTE we might want to initialize each test with a new redis instance
  try {
    new BaseConfig().loadDotEnvFiles();
    global.redisClient = Container.get(RedisService).init();
  } catch(err) {
    console.error("Error in jest global setup", err);
    throw err;
  }
};

