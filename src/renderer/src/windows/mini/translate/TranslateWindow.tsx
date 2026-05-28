import { SwapOutlined } from '@ant-design/icons'
import { loggerService } from '@logger'
import LanguageSelect from '@renderer/components/LanguageSelect'
import Scrollbar from '@renderer/components/Scrollbar'
import { LanguagesEnum } from '@renderer/config/translate'
import db from '@renderer/databases'
import { useDefaultModel } from '@renderer/hooks/useAssistant'
import useTranslate from '@renderer/hooks/useTranslate'
import { storageV2DexieSettingsRecoveryService } from '@renderer/services/StorageV2DexieSettingsRecoveryService'
import { translateText } from '@renderer/services/TranslateService'
import type { TranslateLanguage } from '@renderer/types'
import { runAsyncFunction } from '@renderer/utils'
import { Select } from 'antd'
import { isEmpty } from 'lodash'
import type { FC } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

const logger = loggerService.withContext('TranslateWindow')

interface Props {
  text: string
}

let _targetLanguageCode =
  (
    await storageV2DexieSettingsRecoveryService.getSetting<string>(
      'translate:target:language',
      'mini-translate-target-language-missing'
    )
  )?.value || LanguagesEnum.zhCN.langCode

const Translate: FC<Props> = ({ text }) => {
  const [result, setResult] = useState('')
  const { getLanguageByLangcode } = useTranslate()
  const [targetLanguage, setTargetLanguage] = useState<TranslateLanguage>(() =>
    getLanguageByLangcode(_targetLanguageCode)
  )
  const { translateModel } = useDefaultModel()
  const { t } = useTranslation()
  const translatingRef = useRef(false)

  _targetLanguageCode = targetLanguage.langCode

  const translate = useCallback(async () => {
    if (!text.trim() || !translateModel) return

    if (translatingRef.current) return

    try {
      translatingRef.current = true

      await translateText(text, targetLanguage, setResult)

      translatingRef.current = false
    } catch (error) {
      logger.error('Error fetching result:', error as Error)
    } finally {
      translatingRef.current = false
    }
  }, [text, targetLanguage, translateModel])

  useEffect(() => {
    void runAsyncFunction(async () => {
      const targetLang = await storageV2DexieSettingsRecoveryService.getSetting<string>(
        'translate:target:language',
        'mini-translate-target-language-effect-missing'
      )
      targetLang && setTargetLanguage(getLanguageByLangcode(targetLang.value))
    })
  }, [getLanguageByLangcode])

  useEffect(() => {
    void translate()
  }, [translate])

  useHotkeys('c', () => {
    void navigator.clipboard.writeText(result)
    window.toast.success(t('message.copy.success'))
  })

  return (
    <Container>
      <MenuContainer>
        <Select
          showSearch
          value="any"
          style={{ maxWidth: 200, minWidth: 100, flex: 1 }}
          optionFilterProp="label"
          disabled
          options={[{ label: t('translate.any.language'), value: 'any' }]}
        />
        <SwapOutlined />
        <LanguageSelect
          showSearch
          value={targetLanguage.langCode}
          style={{ maxWidth: 200, minWidth: 130, flex: 1 }}
          optionFilterProp="label"
          onChange={async (value) => {
            await db.settings.put({ id: 'translate:target:language', value })
            setTargetLanguage(getLanguageByLangcode(value))
          }}
        />
      </MenuContainer>
      <Main>
        {isEmpty(result) ? (
          <LoadingText>{t('translate.output.placeholder')}...</LoadingText>
        ) : (
          <OutputContainer>
            <ResultText>{result}</ResultText>
          </OutputContainer>
        )}
      </Main>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: 12px;
  /* padding-right: 0; */
  overflow: hidden;
  -webkit-app-region: none;
`

const Main = styled.div`
  display: flex;
  flex: 1;
  width: 100%;
  overflow: hidden;
`

const ResultText = styled.div`
  white-space: pre-wrap;
  word-break: break-word;
  width: 100%;
`

const LoadingText = styled.div`
  color: var(--color-text-2);
  font-style: italic;
`

const MenuContainer = styled.div`
  display: flex;
  width: 100%;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  margin-bottom: 15px;
  gap: 20px;
`

const OutputContainer = styled(Scrollbar)`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 10px;
`

export default Translate
