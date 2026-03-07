import { config } from "../config.js";
import { sha256 } from "../utils/crypto.js";
import { redisDelete, redisGet, redisIncrWithTtl, redisKey, redisSet, redisTtl } from "../lib/redis.js";

type LoginLockState = {
  locked: boolean;
  retryAfterSec: number;
};

type FailedLoginResult = {
  ipAttempts: number;
  emailAttempts: number;
  locked: boolean;
  retryAfterSec: number;
};

function hashedEmail(email: string) {
  return sha256(email.toLowerCase());
}

function ipFailKey(ip: string) {
  return redisKey("auth", "login", "fail", "ip", ip);
}

function emailFailKey(email: string) {
  return redisKey("auth", "login", "fail", "email", hashedEmail(email));
}

function ipLockKey(ip: string) {
  return redisKey("auth", "login", "lock", "ip", ip);
}

function emailLockKey(email: string) {
  return redisKey("auth", "login", "lock", "email", hashedEmail(email));
}

async function lockLogin(ip: string, email: string): Promise<number> {
  const ttlSec = config.AUTH_LOGIN_LOCKOUT_SEC;
  await Promise.all([
    redisSet(ipLockKey(ip), "1", ttlSec),
    redisSet(emailLockKey(email), "1", ttlSec)
  ]);
  return ttlSec;
}

export async function getLoginLockState(ip: string, email: string): Promise<LoginLockState> {
  const [ipLocked, emailLocked] = await Promise.all([redisGet(ipLockKey(ip)), redisGet(emailLockKey(email))]);
  if (!ipLocked && !emailLocked) {
    return {
      locked: false,
      retryAfterSec: 0
    };
  }

  const [ipTtl, emailTtl] = await Promise.all([redisTtl(ipLockKey(ip)), redisTtl(emailLockKey(email))]);
  return {
    locked: true,
    retryAfterSec: Math.max(1, ipTtl, emailTtl, config.AUTH_LOGIN_LOCKOUT_SEC)
  };
}

export async function recordFailedLoginAttempt(ip: string, email: string): Promise<FailedLoginResult> {
  const [ipCounter, emailCounter] = await Promise.all([
    redisIncrWithTtl(ipFailKey(ip), config.AUTH_LOGIN_WINDOW_SEC),
    redisIncrWithTtl(emailFailKey(email), config.AUTH_LOGIN_WINDOW_SEC)
  ]);

  const lockTriggered =
    ipCounter.count >= config.AUTH_LOGIN_MAX_ATTEMPTS_PER_IP ||
    emailCounter.count >= config.AUTH_LOGIN_MAX_ATTEMPTS_PER_EMAIL;

  const retryAfterSec = lockTriggered ? await lockLogin(ip, email) : Math.max(ipCounter.ttlSec, emailCounter.ttlSec, 1);
  return {
    ipAttempts: ipCounter.count,
    emailAttempts: emailCounter.count,
    locked: lockTriggered,
    retryAfterSec
  };
}

export async function resetLoginAbuseState(ip: string, email: string): Promise<void> {
  await Promise.all([
    redisDelete(ipFailKey(ip)),
    redisDelete(emailFailKey(email)),
    redisDelete(ipLockKey(ip)),
    redisDelete(emailLockKey(email))
  ]);
}
