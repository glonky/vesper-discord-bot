import { Service } from 'typedi';
import { BaseConfig } from '@vesper-discord/config';

@Service()
export class Config extends BaseConfig {
  host = this.getEnvVar<string>('REDIS_TLS_URL' ?? 'REDIS_URL', 'localhost');

  port = this.getEnvVar<number>('REDIS_PORT', 6379);

  ttl = this.getEnvVar<number>('REDIS_TTL', 60 * 60 * 24); // 1 day
}
