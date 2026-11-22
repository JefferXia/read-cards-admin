/**
 * 进程内 LRU 缓存（书列表 / 卡列表等全局不常变数据）。
 * - 存 Promise：并发请求只打一次库（防击穿），失败不缓存
 * - 所有 admin 写操作后调用 invalidateBookCaches() 整体失效（写点少，全部清最不易漏）
 * - 用户级缓存 key 约定 user:<userId>:*，写点调用 invalidateUserCaches(userId) 前缀失效
 * - 注意：seed/import 等脚本直连数据库，不走本进程；改库后需等 TTL 过期或重启服务
 * - 注意：多实例部署（Vercel 多函数实例）各实例独立缓存，TTL 兜底过期
 */
import { LRUCache } from 'lru-cache'

const cache = new LRUCache<string, Promise<unknown>>({
  max: 500, // 全局键个位数；用户级键（念簿/卡包）随用户增长，给足余量
  ttl: 5 * 60 * 1000, // 默认 5 分钟
})

/** 取缓存或执行查询并缓存；失败/返回 undefined 的结果不缓存，下次重查 */
export function getOrSet<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit as Promise<T>
  const p = fetcher()
    .then((v) => {
      if (v === undefined) cache.delete(key) // undefined = 未找到，不缓存（如脚本刚建的书）
      return v
    })
    .catch((e) => {
      cache.delete(key)
      throw e
    })
  cache.set(key, p, { ttl: ttlMs })
  return p
}

/** 失效钩子：lib/study.ts 的 bookCache（独立 Map）注册进来，随统一失效一起清 */
const hooks: (() => void)[] = []
export function onInvalidateBooks(fn: () => void) {
  hooks.push(fn)
}

/** 书/卡数据有写操作时整体失效（书单、发现页、卡组、统计、书目身份缓存） */
export function invalidateBookCaches() {
  cache.clear()
  for (const fn of hooks) fn()
}

/** 按用户失效（念簿/卡包等含个人数据的缓存；key 约定以 user:<userId> 开头） */
export function invalidateUserCaches(userId: string) {
  const prefix = `user:${userId}`
  const keys: string[] = []
  cache.forEach((_v, key) => {
    if (key.startsWith(prefix)) keys.push(key)
  })
  for (const k of keys) cache.delete(k)
}
