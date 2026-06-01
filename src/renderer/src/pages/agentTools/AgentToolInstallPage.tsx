import { Navbar, NavbarCenter } from '@renderer/components/app/Navbar'
import { HStack } from '@renderer/components/Layout'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import { Button, Input, Select, Space, Typography } from 'antd'
import { Bot, ExternalLink, Send, Settings } from 'lucide-react'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const { chat } = useRuntime()
  const [config, setConfig] = useState<ToolConfig>(() => getDefaultConfig(tool))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      const saved = await window.api.appData.get('agent-tools', tool)
      setConfig({ ...getDefaultConfig(tool), ...saved })
    }

    void load()
  }, [tool])

  const installPrompt = useMemo(
    () =>
      t('agentTools.install.prompt', {
        accessToken: config.accessToken || t('agentTools.install.not_filled'),
        fallbackInstall: profile.fallbackInstall,
        modelProvider: config.modelProvider,
        modelsJson: config.modelsJson,
        posixInstall: profile.posixInstall,
        repo: profile.repo,
        title: profile.title,
        verify: profile.verify,
        windowsInstall: profile.windowsInstall
      }),
    [config.accessToken, config.modelProvider, config.modelsJson, profile, t]
  )

  const saveConfig = async () => {
    setSaving(true)
    try {
      await window.api.appData.set('agent-tools', tool, config)
      window.toast.success(t('agentTools.install.saved'))
    } finally {
      setSaving(false)
    }
  }

  const sendToAgent = async () => {
    await saveConfig()
    navigate('/agents')
    window.toast.info(t('agentTools.install.sent_to_agent'))

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
          <SectionTitle>{t('agentTools.install.initialize')}</SectionTitle>
          <CommandBlock>{profile.posixInstall}</CommandBlock>
          <HStack gap="8px">
            <Button type="primary" icon={<Send size={15} />} onClick={sendToAgent}>
              {t('agentTools.install.send_to_agent')}
            </Button>
            <Button icon={<ExternalLink size={15} />} onClick={() => window.api.openWebsite(config.webuiUrl)}>
              {t('agentTools.install.open_webui')}
            </Button>
            <Button loading={saving} icon={<Settings size={15} />} onClick={saveConfig}>
              {t('agentTools.install.save_config')}
            </Button>
          </HStack>
        </Section>

        <Section>
          <SectionTitle>{t('agentTools.install.runtime_config')}</SectionTitle>
          <FormGrid>
            <Label>Access token</Label>
            <Input.Password
              value={config.accessToken}
              onChange={(event) => setConfig((prev) => ({ ...prev, accessToken: event.target.value }))}
              placeholder={t('agentTools.install.access_token_placeholder')}
            />
            <Label>{t('agentTools.install.webui_url')}</Label>
            <Input
              value={config.webuiUrl}
              onChange={(event) => setConfig((prev) => ({ ...prev, webuiUrl: event.target.value }))}
            />
            <Label>{t('agentTools.install.model_service')}</Label>
            <Select
              value={config.modelProvider}
              onChange={(modelProvider) => setConfig((prev) => ({ ...prev, modelProvider }))}
              options={[
                { label: 'OpenAI compatible', value: 'openai-compatible' },
                { label: 'OpenRouter', value: 'openrouter' },
                { label: 'Anthropic', value: 'anthropic' },
                { label: 'Ollama', value: 'ollama' },
                { label: t('agentTools.install.custom'), value: 'custom' }
              ]}
            />
          </FormGrid>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">{t('agentTools.install.models_json')}</Typography.Text>
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
