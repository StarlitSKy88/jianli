export const metadata = {
  title: '用户协议 — Interview Buddy',
  description: 'Interview Buddy 用户服务协议',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen max-w-3xl mx-auto p-8 prose prose-sm">
      <h1>Interview Buddy 用户服务协议</h1>
      <p className="text-gray-500">最后更新：2026-07-15 · 京ICP备2025108350号-2</p>

      <h2>1. 服务说明</h2>
      <p>
        Interview Buddy 是一款面向 35+ 求职群体的 AI 面试陪练 Web
        应用，模拟字节跳动、阿里巴巴、腾讯、B站 4 家公司的真实面试流程，每日提供 3 次免费模拟。
      </p>

      <h2>2. 用户行为规范</h2>
      <p>用户在使用本服务时，不得：</p>
      <ul>
        <li>违反《就业促进法》《个人信息保护法》等法律法规</li>
        <li>使用脚本、机器人等自动化手段刷量</li>
        <li>利用本服务从事任何违法活动</li>
      </ul>

      <h2>3. 知识产权</h2>
      <p>
        本服务使用的面试官 prompt 协议、场景题库为平台原创内容；用户对话内容版权归用户本人所有。
        平台不会将用户对话用于公开展示或 AI 模型训练。
      </p>

      <h2>4. 免责声明</h2>
      <p>
        本服务为"模拟面试"性质，**AI 给出的反馈不构成任何求职建议、心理咨询或职业规划服务**。
        平台不对用户根据 AI 反馈做出的任何求职决定承担责任。
      </p>

      <h2>5. 服务变更与终止</h2>
      <p>
        平台保留随时修改或终止服务的权利。重大变更将通过站内公告或邮件通知。 用户可随时通过{' '}
        <code>delaccount@taomyst.top</code>
        申请账号删除（30 天内彻底清除数据）。
      </p>

      <h2>6. 联系方式</h2>
      <p>如有疑问请联系：support@taomyst.top</p>

      <p className="text-gray-400 text-xs mt-8">
        <a href="/login">返回登录</a> · <a href="/legal/privacy">隐私政策</a>
      </p>
    </main>
  );
}
