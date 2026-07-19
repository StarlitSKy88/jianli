# Phase 14.2 完整 30 轮面试审计材料

## 背景
- 面试 ID: cmrlu2zp2004q3yt19a28bv7t
- 用户: 李明（虚构）38岁 / 10年Go后端 / 字节推荐系统
- 公司: 字节 / 岗位: backend / 级别: P7
- 简历 ID: cmrlu2hle004n3yt19aq6zsfs
- 真实 AI Provider: OpenRouter Hy3（Tencent 免费模型）

## 30 轮真实问题脚本
1. 你好，我叫李明，今年38岁，有10年后端开发经验
2. 我之前在字节跳动做过 3 年推荐系统后端
3. 推荐系统后端的核心挑战是低延迟和高吞吐
4. 我们用 Flink 实时计算用户兴趣向量
5. Flink 的 watermark 机制能解决乱序问题
6. 乱序问题在大流量下很常见，比如百万 QPS
7. 我当时做的一个优化是把 Redis pipeline 化
8. Redis pipeline 减少了 70% 的网络往返时间
9. 另一个优化是引入本地缓存 LRU + 分布式缓存
10. 这样能扛住热点 key 的访问压力
11. 热点 key 的本质是流量倾斜
12. 流量倾斜在直播间和电商秒杀很常见
13. 秒杀系统的设计核心是库存扣减的原子性
14. 我们用 Redis Lua 脚本保证原子扣减
15. Lua 脚本比分布式锁性能高 10 倍
16. 分布式锁在 Redis 主从切换时可能失效
17. 所以用 Redlock 或者 etcd 更可靠
18. 但 Redlock 实现复杂，运维成本高
19. 实际项目我们用 Redis 集群 + 异步补偿
20. 异步补偿基于消息队列，最终一致性
21. Kafka 在我们项目里扛日均千亿级消息
22. Kafka 的 ISR 机制保证数据不丢
23. ISR 收缩和扩张是 Kafka 运维的关键
24. 遇到过 ISR 频繁收缩的问题吗
25. 遇到过，后来调小了 replica.lag.time.max.ms
26. 另外 producer 用 acks=all + idempotent 保证不丢
27. 幂等性是用 PID + sequence number 实现的
28. 是的，broker 端会缓存最近 5 个 sequence
29. 聊一下你的职业规划，35+ 之后怎么走
30. 我面试结束了，谢谢

## 真实结果
- 19/30 轮 HTTP=200
- 11/30 轮 STREAM_ERROR (AI provider 402 配额耗尽)
- 总输出字符: 1651
- 评分: 未生成 (REPORT_NOT_FOUND)
- 评分失败根因: byte 公司缺少 cs.md / sysdesign.md 评分 prompt

## 关键修复（已实施）
1. route.ts: history 从 `slice(0, -1)` 改为 `body.data.messages` (全量历史)
2. route.ts: 简历从硬编码空对象改为读 `interview.resume.yearsOfExperience/techStack/parsed`
3. .knowledge/agents/scorer/byte/cs.md 新建
4. .knowledge/agents/scorer/byte/sysdesign.md 新建

## 关键证据：第 2 轮 AI 上下文响应（成功）
user: "我之前在字节跳动做过 3 年推荐系统后端"
ai:   "你之前在字节做推荐系统后端有3年经验，能挑一个你最熟悉或近来做的推荐系统项目，整体介绍一下它的业务目标、你担任的角色以及核心技术栈吗？我们先听整体，细节后面再聊。"
