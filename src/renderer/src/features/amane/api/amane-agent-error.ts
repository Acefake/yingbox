interface AgentErrorInfo {
  title: string
  message: string
  settings: boolean
  model?: string
}
export function describeAgentError(raw: string): AgentErrorInfo {
  const model = raw.match(/model_name[:=]\s*['"]?([^,'"}\s]+)/i)?.[1]
  const base = { model, settings: true }
  if (
    /status_code[:=]\s*402|HTTP\s*402|insufficient.{0,30}(balance|credit)|balance.{0,20}insufficient|余额不足|账户余额不足|['"]?code['"]?\s*:\s*30001/i.test(
      raw
    )
  )
    return {
      ...base,
      title: '模型服务余额不足',
      message:
        '当前模型服务商账户的余额不足，本次对话未能完成。请在服务商处充值，或在智能体设置中切换有余额的服务与模型。',
    }
  if (
    /status_code[:=]\s*401|HTTP\s*401|invalid.{0,10}(api.?key|token)|unauthorized/i.test(
      raw
    )
  )
    return {
      ...base,
      title: '模型服务认证失败',
      message: '请在智能体设置中检查 API Key 和服务地址。',
    }
  if (/status_code[:=]\s*403|HTTP\s*403|permission denied|forbidden/i.test(raw))
    return {
      ...base,
      title: '模型访问被拒绝',
      message: '当前账户可能没有此模型的访问权限，请检查服务商授权或切换模型。',
    }
  if (
    /status_code[:=]\s*429|HTTP\s*429|rate.?limit|too many requests/i.test(raw)
  )
    return {
      ...base,
      title: '模型请求过于频繁',
      message: '请稍后重新发送，或在智能体设置中降低请求频率。',
    }
  if (/未配置|not configured/i.test(raw))
    return {
      ...base,
      title: '尚未配置智能体',
      message: '请先在智能体设置中填写服务地址、API Key 和模型名称。',
    }
  if (
    /timeout|timed out|超时|fetch failed|failed to fetch|ECONNREFUSED|network/i.test(
      raw
    )
  )
    return {
      ...base,
      title: '暂时无法连接模型服务',
      message: '请检查网络、代理和服务地址，恢复连接后重新发送。',
    }
  return {
    ...base,
    settings: false,
    title: '本次对话未完成',
    message: '请查看技术详情确认原因，处理后重新发送消息。已有对话会保留。',
  }
}
export function redactAgentError(raw: string): string {
  return raw
    .replace(/(Bearer\s+)[^\s'",}]+/gi, '$1[已隐藏]')
    .replace(
      /((?:api[_-]?key|api[_-]?token|authorization|password)['"]?\s*[:=]\s*['"]?)[^'"\s,}]+/gi,
      '$1[已隐藏]'
    )
    .replace(/\bsk-[a-zA-Z0-9_-]{12,}/g, '[已隐藏]')
}
