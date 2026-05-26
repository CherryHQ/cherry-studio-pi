import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Button, Input, Select, Space, Typography } from 'antd'
import { Bot, ExternalLink, Send, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

type ToolId = 'openclaw' | 'hermes'

type Props = {
  tool: ToolId
}

type ToolConfig = {
  accessToken: string
  webuiUrl: string
  modelProvider: string
  modelsJson: string
}

const profiles = {
  openclaw: {
    title: 'OpenClaw',
    repo: 'https://github.com/openclaw/openclaw',
    defaultWebuiUrl: 'http://localhost:18790',
    posixInstall: 'curl -fsSL https://openclaw.ai/install.sh | bash',
    windowsInstall: 'iwr -useb https://openclaw.ai/install.ps1 | iex',
    fallbackInstall: 'npm install -g openclaw@latest && openclaw onboard --install-daemon',
    verify: 'openclaw --version && openclaw doctor && openclaw gateway status'
  },
  hermes: {
    title: 'Hermes',
    repo: 'https://github.com/NousResearch/hermes-agent',
    defaultWebuiUrl: 'http://localhost:8000',
    posixInstall:
      'curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash',
    windowsInstall: 'iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)',
    fallbackInstall:
      'git clone https://github.com/NousResearch/hermes-agent.git ~/.hermes/hermes-agent && cd ~/.hermes/hermes-agent && ./setup-hermes.sh',
    verify: 'hermes doctor'
  }
} satisfies Record<ToolId, Record<string, string>>

const getDefaultConfig = (tool: ToolId): ToolConfig => ({
  accessToken: '',
  webuiUrl: profiles[tool].defaultWebuiUrl,
  modelProvider: 'openai-compatible',
  modelsJson: JSON.stringify(
    [
      {
        name: 'primary',
        provider: 'openai-compatible',
        model: '',
        baseUrl: '',
        apiKey: ''
      }
    ],
    null,
    2
  )
})

const AgentToolInstallPage: FC<Props> = ({ tool }) => {
  const profile = profiles[tool]
  const navigate = useNavigate()
  const { chat } = useRuntime()
  const [config, setConfig] = useState<ToolConfig>(() => getDefaultConfig(tool))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      const saved = await window.api.appData.get('agent-tools', tool)
      setConfig({ ...getDefaultConfig(tool), ...(saved || {}) })
    }

    void load()
  }, [tool])

  const installPrompt = useMemo(
    () => `请帮我全局安装并初始化 ${profile.title}。

项目地址：${profile.repo}

官方推荐安装命令：
- macOS / Linux / WSL：${profile.posixInstall}
- Windows PowerShell：${profile.windowsInstall}
- 如果当前系统更适合 npm/源码兜底：${profile.fallbackInstall}

安装完成后请做这些事：
1. 验证安装：${profile.verify}
2. 如需启动本地 WebUI 或 dashboard，请启动并确认访问地址。
3. 将下面的配置写入 ${profile.title} 的实际配置文件或通过它的 CLI 配置命令写入；如果路径不确定，请先用官方命令或源码结构定位，不要猜路径。
4. 配置完成后返回 WebUI 地址、关键命令输出和下一步使用方式。

Access token:
${config.accessToken || '(未填写)'}

模型服务类型:
${config.modelProvider}

多模型配置：
${config.modelsJson}
`,
    [config.accessToken, config.modelProvider, config.modelsJson, profile]
  )

  const saveConfig = async () => {
    setSaving(true)
    try {
      await window.api.appData.set('agent-tools', tool, config)
      window.toast.success('配置已保存')
    } finally {
      setSaving(false)
    }
  }

  const sendToAgent = async () => {
    await saveConfig()
    navigate('/agents')
    window.toast.info('已把安装任务发送给 Agent')

    const payload = {
      requestId: `${tool}-${Date.now()}`,
      agentId: chat.activeAgentId,
      sessionId: chat.activeAgentId ? chat.activeSessionIdMap[chat.activeAgentId] : undefined,
      text: installPrompt
    }

    sessionStorage.setItem('pending-agent-run-prompt', JSON.stringify(payload))
    setTimeout(() => void EventEmitter.emit(EVENT_NAMES.AGENT_RUN_PROMPT, payload), 500)
  }

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderRight: 'none' }}>{profile.title}</NavbarCenter>
      </Navbar>
      <Content>
        <Hero>
          <IconWrap>
            <Bot size={28} />
          </IconWrap>
          <div>
            <Title>{profile.title}</Title>
            <Description>{profile.repo}</Description>
          </div>
        </Hero>

        <Section>
          <SectionTitle>初始化</SectionTitle>
          <CommandBlock>{profile.posixInstall}</CommandBlock>
          <HStack gap="8px">
            <Button type="primary" icon={<Send size={15} />} onClick={sendToAgent}>
              交给 Agent 安装
            </Button>
            <Button icon={<ExternalLink size={15} />} onClick={() => window.api.openWebsite(config.webuiUrl)}>
              打开 WebUI
            </Button>
            <Button loading={saving} icon={<Settings size={15} />} onClick={saveConfig}>
              保存配置
            </Button>
          </HStack>
        </Section>

        <Section>
          <SectionTitle>运行配置</SectionTitle>
          <FormGrid>
            <Label>Access token</Label>
            <Input.Password
              value={config.accessToken}
              onChange={(event) => setConfig((prev) => ({ ...prev, accessToken: event.target.value }))}
              placeholder="可选，用于写入工具配置"
            />
            <Label>WebUI 地址</Label>
            <Input
              value={config.webuiUrl}
              onChange={(event) => setConfig((prev) => ({ ...prev, webuiUrl: event.target.value }))}
            />
            <Label>模型服务</Label>
            <Select
              value={config.modelProvider}
              onChange={(modelProvider) => setConfig((prev) => ({ ...prev, modelProvider }))}
              options={[
                { label: 'OpenAI compatible', value: 'openai-compatible' },
                { label: 'OpenRouter', value: 'openrouter' },
                { label: 'Anthropic', value: 'anthropic' },
                { label: 'Ollama', value: 'ollama' },
                { label: '自定义', value: 'custom' }
              ]}
            />
          </FormGrid>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">多模型配置 JSON</Typography.Text>
            <Input.TextArea
              value={config.modelsJson}
              onChange={(event) => setConfig((prev) => ({ ...prev, modelsJson: event.target.value }))}
              autoSize={{ minRows: 8, maxRows: 14 }}
            />
          </Space>
        </Section>
      </Content>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  overflow: hidden;
`

const Content = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 18px;
  overflow: auto;
  padding: 28px;
  max-width: 920px;
`

const Hero = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
`

const IconWrap = styled.div`
  display: flex;
  width: 48px;
  height: 48px;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
  color: var(--color-primary);
`

const Title = styled.h1`
  margin: 0;
  color: var(--color-text);
  font-size: 22px;
  font-weight: 600;
`

const Description = styled.div`
  margin-top: 4px;
  color: var(--color-text-2);
  font-size: 13px;
`

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const SectionTitle = styled.h2`
  margin: 0;
  color: var(--color-text);
  font-size: 15px;
  font-weight: 500;
`

const CommandBlock = styled.pre`
  margin: 0;
  padding: 12px;
  overflow: auto;
  border-radius: 8px;
  background: var(--color-background-mute);
  color: var(--color-text);
  font-size: 12px;
`

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: 112px minmax(0, 1fr);
  gap: 10px 12px;
  align-items: center;
`

const Label = styled.div`
  color: var(--color-text-2);
  font-size: 13px;
`

export default AgentToolInstallPage
