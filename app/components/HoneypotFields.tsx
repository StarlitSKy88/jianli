'use client';
/**
 * 蜜罐字段组件
 *
 * 用法：放在 form 内任意位置，机器人会填、真人不会。
 * CSS 隐藏 + tabIndex=-1 + autoComplete=off + aria-hidden。
 *
 * 服务端通过 lib/auth/anti-abuse.isHoneypotTriggered(body) 检测。
 */
import { useState } from 'react';

export function HoneypotFields() {
  // 默认值：3 个字段名，避免机器人只过滤一个
  const [website, setWebsite] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');

  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        left: '-10000px',
        top: 'auto',
        width: '1px',
        height: '1px',
        overflow: 'hidden',
      }}
    >
      <label>
        Website (don&apos;t fill)
        <input
          type="text"
          name="website"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </label>
      <label>
        Company name (don&apos;t fill)
        <input
          type="text"
          name="company_name"
          tabIndex={-1}
          autoComplete="off"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
        />
      </label>
      <label>
        Phone number (don&apos;t fill)
        <input
          type="tel"
          name="phone_number"
          tabIndex={-1}
          autoComplete="off"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
        />
      </label>
    </div>
  );
}
