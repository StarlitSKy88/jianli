export const metadata = {
  title: '隐私政策 — Interview Buddy',
  description: 'Interview Buddy 隐私政策（符合《个人信息保护法》要求）',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen max-w-3xl mx-auto p-8 prose prose-sm">
      <h1>Interview Buddy 隐私政策</h1>
      <p className="text-gray-500">最后更新：2026-07-15 · 京ICP备2025108350号-2</p>

      <h2>1. 我们收集什么</h2>
      <table>
        <thead>
          <tr>
            <th>类型</th>
            <th>用途</th>
            <th>保留期</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>邮箱地址</td>
            <td>账号 + 验证码登录</td>
            <td>账号删除后 30 天</td>
          </tr>
          <tr>
            <td>简历（可选）</td>
            <td>个性化面试对话</td>
            <td>账号删除后 30 天</td>
          </tr>
          <tr>
            <td>面试对话记录</td>
            <td>评分报告 + 历史回看</td>
            <td>账号删除后 30 天</td>
          </tr>
          <tr>
            <td>IP 地址</td>
            <td>反爬虫 + 反刷号</td>
            <td>24 小时后丢弃</td>
          </tr>
        </tbody>
      </table>

      <h2>
        2. 我们<strong>不</strong>收集什么
      </h2>
      <p>
        严格遵守《就业促进法》第 27 条，<strong>永远不</strong>收集以下信息：
      </p>
      <ul>
        <li>婚否 / 有无子女 / 是否有房</li>
        <li>民族 / 宗教信仰 / 户籍性质</li>
        <li>身高 / 体重 / 容貌（除非用户主动提交简历）</li>
      </ul>

      <h2>3. 第三方服务</h2>
      <table>
        <thead>
          <tr>
            <th>服务</th>
            <th>用途</th>
            <th>数据</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cloudflare Turnstile</td>
            <td>反机器人验证</td>
            <td>浏览器行为特征（不存个人身份）</td>
          </tr>
          <tr>
            <td>OpenRouter / Tencent Hy3</td>
            <td>AI 对话推理</td>
            <td>
              对话消息（<strong>不</strong>用于模型训练）
            </td>
          </tr>
          <tr>
            <td>腾讯云 PostgreSQL</td>
            <td>数据持久化</td>
            <td>用户表 + 面试记录</td>
          </tr>
          <tr>
            <td>EdgeOne Pages</td>
            <td>静态资源 + 国内 CDN</td>
            <td>访问日志（30 天后自动清理）</td>
          </tr>
        </tbody>
      </table>

      <h2>4. 数据出境</h2>
      <p>
        所有数据均存储在<strong>中国大陆境内</strong>（腾讯云北京/上海）。 AI 推理通过 OpenRouter
        路由， 可能路由至境外推理节点（Tencent Hy3 提供方在 NovitaAI 国内节点）。 您的
        <strong>个人身份信息</strong>（邮箱/简历）<strong>不会</strong>发送给境外。
      </p>

      <h2>5. 您的权利</h2>
      <p>您有权随时：</p>
      <ul>
        <li>
          查看自己所有存储数据（通过 <code>/api/profile/export</code>）
        </li>
        <li>修改简历 / 个人信息</li>
        <li>
          删除账号（<code>delaccount@taomyst.top</code>，30 天内彻底清除）
        </li>
        <li>撤回隐私授权（账号一并注销）</li>
      </ul>

      <h2>6. 数据保护措施</h2>
      <ul>
        <li>密码用 bcrypt 加盐哈希存储（不可逆）</li>
        <li>JWT token 含过期时间（默认 7 天）</li>
        <li>数据库 SSL 加密连接</li>
        <li>每日增量备份 → 30 天滚动归档</li>
      </ul>

      <h2>7. 联系 DPO</h2>
      <p>数据保护联系人：dpo@taomyst.top</p>

      <p className="text-gray-400 text-xs mt-8">
        <a href="/login">返回登录</a> · <a href="/legal/terms">用户协议</a>
      </p>
    </main>
  );
}
