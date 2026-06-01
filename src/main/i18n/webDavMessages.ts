export const WEB_DAV_DEFAULT_ACTION = '访问 WebDAV'

export const WEB_DAV_NETWORK_ERROR_PATTERNS = [
  { pattern: /\bENOTFOUND\b|\bEAI_AGAIN\b/i, message: '无法解析 WebDAV 地址，请检查域名或当前网络 DNS。' },
  { pattern: /\bECONNREFUSED\b/i, message: 'WebDAV 服务拒绝连接，请确认地址和端口正确，服务正在运行。' },
  { pattern: /\bETIMEDOUT\b|\bESOCKETTIMEDOUT\b|timeout/i, message: '连接 WebDAV 超时，请稍后重试或检查网络。' },
  { pattern: /\bECONNRESET\b|\bsocket hang up\b/i, message: '连接被 WebDAV 服务中断，请稍后重试。' },
  { pattern: /\bCERT_|certificate|self[- ]signed/i, message: 'WebDAV HTTPS 证书异常，请检查服务端证书配置。' }
]

export const formatWebDavFailurePrefix = (action: string) => `${action}失败`

export const formatWebDavTargetText = (target: string) => `（路径：${target}）`

export const formatWebDavUnauthorizedMessage = (prefix: string) =>
  `${prefix}：账号或密码验证失败。请检查 WebDAV 用户名、密码或应用专用密码是否正确。`

export const formatWebDavWriteForbiddenMessage = (prefix: string, targetText: string) =>
  `${prefix}：WebDAV 服务拒绝写入${targetText}。这个端点可能是只读的，或当前账号没有写入权限；数据同步需要支持 MKCOL、PUT、DELETE。请更换可写的 WebDAV 地址/账号，或在服务端重新生成带写入权限的授权。`

export const formatWebDavReadForbiddenMessage = (prefix: string, targetText: string) =>
  `${prefix}：当前账号没有访问这个 WebDAV 目录的权限${targetText}。请在“数据设置 > 多端数据同步”里重新选择一个已存在且可写的目录；如果 WebDAV 地址本身已经指向账号目录，同步目录只需要选择该目录下的子目录。`

export const formatWebDavNotFoundMessage = (prefix: string) =>
  `${prefix}：找不到远程目录或文件。软件会在同步时自动创建同步目录；如果仍失败，请先在目录选择器里选择一个已存在的上级目录。`

export const formatWebDavConflictMessage = (prefix: string) =>
  `${prefix}：远程目录结构冲突。请重新选择一个已存在且可写的目录，软件会自动创建需要的子目录。`

export const formatWebDavLockedMessage = (prefix: string) =>
  `${prefix}：远程目录或文件被 WebDAV 服务锁定。请稍后重试，或在服务端解除锁定。`

export const formatWebDavRateLimitedMessage = (prefix: string) =>
  `${prefix}：WebDAV 服务限流。软件已经自动重试但仍失败，请稍后再同步。`

export const formatWebDavInsufficientStorageMessage = (prefix: string) =>
  `${prefix}：WebDAV 空间不足。请清理远程空间或更换同步目录。`

export const formatWebDavUnavailableMessage = (prefix: string) =>
  `${prefix}：WebDAV 服务暂时不可用或网关超时。软件已经自动重试但仍失败，请稍后再试，或检查 WebDAV 服务商状态。`

export const formatWebDavUnhandledStatusMessage = (prefix: string, status: number) =>
  `${prefix}：WebDAV 返回了无法处理的状态（${status}）。请检查 WebDAV 地址、账号权限和同步目录。`

export const formatWebDavNetworkMessage = (prefix: string, message: string) => `${prefix}：${message}`

export const formatWebDavHostRequiredMessage = (prefix: string) => `${prefix}：请先填写 WebDAV 地址。`

export const formatWebDavInvalidUrlMessage = (prefix: string) =>
  `${prefix}：WebDAV 地址格式不正确。请填写完整地址，例如 https://example.com/dav。`

export const formatWebDavUnknownMessage = (prefix: string) =>
  `${prefix}：发生未知错误，请检查 WebDAV 地址、账号权限和同步目录后重试。`
