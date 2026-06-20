import { useTheme } from '@renderer/context/ThemeProvider'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { EnvironmentDependenciesStatus, EnvironmentDependencyStatus } from '@shared/config/types'
import { Button, Popconfirm, Space, Tag } from 'antd'
import { Download, FolderOpen, RefreshCw, Trash2 } from 'lucide-react'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingContainer, SettingDescription, SettingGroup, SettingRow, SettingRowTitle, SettingTitle } from '.'

const EnvironmentDependenciesSettings: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const [status, setStatus] = useState<EnvironmentDependenciesStatus>()
  const [loading, setLoading] = useState(true)
  const [activeAction, setActiveAction] = useState<string>()
  const mountedRef = useRef(true)
  const statusRequestSeqRef = useRef(0)
  const actionRequestSeqRef = useRef(0)
  const actionInFlightRef = useRef(false)

  const loadStatus = useCallback(async () => {
    const requestSeq = ++statusRequestSeqRef.current
    setLoading(true)
    try {
      const nextStatus = await window.api.environmentDependencies.getStatus()
      if (mountedRef.current && requestSeq === statusRequestSeqRef.current) {
        setStatus(nextStatus)
      }
    } catch (error: any) {
      if (mountedRef.current && requestSeq === statusRequestSeqRef.current) {
        window.toast.error(error.message)
      }
    } finally {
      if (mountedRef.current && requestSeq === statusRequestSeqRef.current) {
        setLoading(false)
      }
    }
  }, [])

  const runAction = async (action: string, fn: () => Promise<EnvironmentDependenciesStatus>, successKey: string) => {
    if (actionInFlightRef.current) {
      return
    }

    actionInFlightRef.current = true
    const requestSeq = ++actionRequestSeqRef.current
    setActiveAction(action)
    try {
      const nextStatus = await fn()
      if (mountedRef.current && requestSeq === actionRequestSeqRef.current) {
        setStatus(nextStatus)
        window.toast.success(t(successKey))
      }
    } catch (error: any) {
      if (mountedRef.current && requestSeq === actionRequestSeqRef.current) {
        window.toast.error(error.message)
      }
    } finally {
      if (mountedRef.current && requestSeq === actionRequestSeqRef.current) {
        setActiveAction(undefined)
      }
      if (requestSeq === actionRequestSeqRef.current) {
        actionInFlightRef.current = false
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
      statusRequestSeqRef.current += 1
      actionRequestSeqRef.current += 1
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const openManagedDir = () => {
    if (status?.managedDir) {
      void window.api.openPath(status.managedDir).catch((error) => {
        window.toast.error(formatErrorMessageWithPrefix(error, t('common.operation_failed')))
      })
    }
  }

  return (
    <SettingContainer theme={theme}>
      <SettingGroup theme={theme}>
        <SettingTitle>{t('settings.environment.title')}</SettingTitle>
        <SettingDescription>{t('settings.environment.description')}</SettingDescription>
        <RuntimeRow>
          <div>
            <SettingRowTitle>{t('settings.environment.integratedRuntime')}</SettingRowTitle>
            <PathText>{status?.managedDir}</PathText>
          </div>
          <Space>
            <Button icon={<FolderOpen size={15} />} onClick={openManagedDir} disabled={!status?.managedDir}>
              {t('settings.environment.openDir')}
            </Button>
            <Button
              type="primary"
              icon={<Download size={15} />}
              disabled={Boolean(activeAction) && activeAction !== 'install'}
              loading={activeAction === 'install'}
              onClick={() =>
                runAction('install', window.api.environmentDependencies.install, 'settings.environment.installSuccess')
              }>
              {t('settings.environment.reinstall')}
            </Button>
            <Popconfirm
              title={t('settings.environment.uninstallConfirm')}
              disabled={Boolean(activeAction) && activeAction !== 'uninstall'}
              onConfirm={() =>
                runAction(
                  'uninstall',
                  window.api.environmentDependencies.uninstall,
                  'settings.environment.uninstallSuccess'
                )
              }>
              <Button
                danger
                icon={<Trash2 size={15} />}
                disabled={Boolean(activeAction) && activeAction !== 'uninstall'}
                loading={activeAction === 'uninstall'}>
                {t('settings.environment.uninstall')}
              </Button>
            </Popconfirm>
          </Space>
        </RuntimeRow>
      </SettingGroup>

      <SettingGroup theme={theme}>
        <HeaderRow>
          <SettingTitle>{t('settings.environment.dependencies')}</SettingTitle>
          <Button
            icon={<RefreshCw size={15} />}
            onClick={loadStatus}
            loading={loading}
            disabled={Boolean(activeAction)}>
            {t('settings.environment.refresh')}
          </Button>
        </HeaderRow>
        <DependencyList>
          {status?.dependencies.map((dependency) => (
            <DependencyRow key={dependency.id}>
              <DependencyInfo>
                <SettingRowTitle>{dependency.name}</SettingRowTitle>
                <PathText>{dependency.path || t('settings.environment.notFound')}</PathText>
              </DependencyInfo>
              <Space>
                {dependency.version && <VersionText>{dependency.version}</VersionText>}
                <Tag color={tagColor(dependency)}>{sourceLabel(dependency, t)}</Tag>
                {dependency.id === 'uv' && dependency.source === 'missing' && (
                  <Button
                    size="small"
                    icon={<Download size={13} />}
                    disabled={Boolean(activeAction) && activeAction !== 'uv'}
                    loading={activeAction === 'uv'}
                    onClick={() =>
                      runAction(
                        'uv',
                        window.api.environmentDependencies.installUv,
                        'settings.environment.installSuccess'
                      )
                    }>
                    {t('settings.environment.install')}
                  </Button>
                )}
                {dependency.id === 'bun' && dependency.source === 'missing' && (
                  <Button
                    size="small"
                    icon={<Download size={13} />}
                    disabled={Boolean(activeAction) && activeAction !== 'bun'}
                    loading={activeAction === 'bun'}
                    onClick={() =>
                      runAction(
                        'bun',
                        window.api.environmentDependencies.installBun,
                        'settings.environment.installSuccess'
                      )
                    }>
                    {t('settings.environment.install')}
                  </Button>
                )}
              </Space>
            </DependencyRow>
          ))}
        </DependencyList>
      </SettingGroup>
    </SettingContainer>
  )
}

const sourceLabel = (dependency: EnvironmentDependencyStatus, t: (key: string) => string) => {
  if (dependency.source === 'managed') return t('settings.environment.source.managed')
  if (dependency.source === 'runtime') return t('settings.environment.source.runtime')
  if (dependency.source === 'system') return t('settings.environment.source.system')
  return dependency.required
    ? t('settings.environment.source.requiredMissing')
    : t('settings.environment.source.missing')
}

const tagColor = (dependency: EnvironmentDependencyStatus) => {
  if (dependency.source === 'missing') return dependency.required ? 'red' : 'default'
  if (dependency.source === 'managed' || dependency.source === 'runtime') return 'green'
  return 'blue'
}

const RuntimeRow = styled(SettingRow)`
  align-items: flex-start;
  gap: 14px;
  margin-top: 16px;
`

const HeaderRow = styled(SettingRow)`
  margin-bottom: 12px;
`

const DependencyList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const DependencyRow = styled(SettingRow)`
  min-height: 44px;
  padding: 9px 0;
  border-bottom: 0.5px solid var(--color-border);

  &:last-child {
    border-bottom: 0;
  }
`

const DependencyInfo = styled.div`
  min-width: 0;
`

const PathText = styled(SettingDescription)`
  margin-top: 4px;
  max-width: 520px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

const VersionText = styled.span`
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-foreground-muted);
  font-size: 12px;
`

export default EnvironmentDependenciesSettings
