/**
 * 一次性 SMTP 链路连通脚本（CJS 避免 tsx 依赖）
 * 用法：node --env-file=.env.local scripts/smtp-test.cjs
 */
const nodemailer = require('nodemailer');

async function main() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || '465');
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  const fromName = process.env.SMTP_FROM_NAME || 'Interview Buddy';

  if (!host || !user || !pass) {
    console.error('❌ 缺 env: SMTP_HOST / SMTP_USER / SMTP_PASSWORD');
    process.exit(1);
  }

  console.log('🌐 连接 SMTP:', host + ':' + port);

  const transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });

  try {
    await transporter.verify();
    console.log('✅ SMTP 握手成功（账号密码有效 + 端口通）');
  } catch (e) {
    console.error('❌ SMTP 握手失败: ' + e.message);
    if (e.code) console.error('   code: ' + e.code);
    if (e.responseCode) console.error('   responseCode: ' + e.responseCode);
    if (e.response) console.error('   response: ' + e.response);
    process.exit(1);
  }

  const info = await transporter.sendMail({
    from: '"' + fromName + '" <' + user + '>',
    to: 'support@taomyst.top',
    subject: '【SMTP 测试】Interview Buddy 邮件链路连通成功',
    text: [
      '这是一封测试邮件，由 Interview Buddy 自动化发出。',
      '',
      '时间: ' + new Date().toISOString(),
      'host: ' + host + ':' + port,
      'user: ' + user,
      '',
      '如果您看到这封邮件，说明：',
      '1. SMTP 账号密码有效',
      '2. 465 端口通畅',
      '3. SPF/DKIM/MX DNS 验证通过',
    ].join('\n'),
  });
  console.log('✅ 测试邮件已发出! messageId =', info.messageId);
  console.log('   envelope: ' + JSON.stringify(info.envelope));
  console.log('   accepted: ' + JSON.stringify(info.accepted));
  console.log('   rejected: ' + JSON.stringify(info.rejected));
}

main().catch((e) => {
  console.error('❌ 异常:', e.message);
  process.exit(1);
});
