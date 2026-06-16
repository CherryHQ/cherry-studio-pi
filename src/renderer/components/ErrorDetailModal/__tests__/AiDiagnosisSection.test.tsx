import { act, render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import AiDiagnosisSection, { type AiDiagnosisSectionHandle } from '../AiDiagnosisSection'

const mocks = vi.hoisted(() => ({
  diagnoseError: vi.fn()
}))

vi.mock('@renderer/services/ErrorDiagnosisService', () => ({
  diagnoseError: (...args: unknown[]) => mocks.diagnoseError(...args)
}))

vi.mock('@data/DataApiService', () => ({
  dataApiService: {
    get: vi.fn(),
    patch: vi.fn()
  }
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      warn: vi.fn()
    })
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'zh-CN' },
    t: (key: string) => key
  })
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

describe('AiDiagnosisSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('ignores duplicate diagnosis requests while one is already running', async () => {
    const diagnosis = {
      summary: 'summary',
      category: 'network',
      explanation: 'explanation',
      steps: [{ text: 'step' }]
    }
    const runningDiagnosis = deferred<typeof diagnosis>()
    mocks.diagnoseError.mockReturnValueOnce(runningDiagnosis.promise)
    const onStatusChange = vi.fn()
    let handle: AiDiagnosisSectionHandle | null = null

    render(
      <AiDiagnosisSection
        ref={(value) => {
          handle = value
        }}
        error={{ name: 'Error', message: 'network failed', stack: null }}
        status="idle"
        onStatusChange={onStatusChange}
      />
    )

    await act(async () => {
      handle?.runDiagnosis()
      handle?.runDiagnosis()
    })

    expect(mocks.diagnoseError).toHaveBeenCalledTimes(1)

    await act(async () => {
      runningDiagnosis.resolve(diagnosis)
    })

    await waitFor(() => {
      expect(onStatusChange).toHaveBeenCalledWith('done')
    })
  })
})
