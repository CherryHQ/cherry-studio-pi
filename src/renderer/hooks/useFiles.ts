import type { FileMetadata } from '@renderer/types'
import { filterSupportedFiles } from '@renderer/utils'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  /** 支持选择的扩展名 */
  extensions?: string[]
}

export const useFiles = (props?: Props) => {
  const { t } = useTranslation()

  const [files, setFiles] = useState<FileMetadata[]>([])
  const [selecting, setSelecting] = useState<boolean>(false)
  const mountedRef = useRef(true)
  const selectingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  const extensions = useMemo(() => {
    if (props?.extensions) {
      return props.extensions
    } else {
      return ['*']
    }
  }, [props?.extensions])

  /**
   * 选择文件的回调函数
   * @param multipleSelections - 是否允许多选文件，默认为 true
   * @returns 返回选中的文件元数据数组
   * @description
   * 1. 打开系统文件选择对话框
   * 2. 根据扩展名过滤文件
   * 3. 更新内部文件状态
   * 4. 当选择了不支持的文件类型时，会显示提示信息
   */
  const onSelectFile = useCallback(
    async ({ multipleSelections = true }: { multipleSelections?: boolean }): Promise<FileMetadata[]> => {
      if (selectingRef.current) {
        return []
      }

      selectingRef.current = true
      const selectProps: Electron.OpenDialogOptions['properties'] = multipleSelections
        ? ['openFile', 'multiSelections']
        : ['openFile']

      // when the number of extensions is greater than 20, use *.* to avoid selecting window lag
      const useAllFiles = extensions.length > 20

      setSelecting(true)
      try {
        const _files = await window.api.file.select({
          properties: selectProps,
          filters: [
            {
              name: 'Files',
              extensions: useAllFiles ? ['*'] : extensions.map((i) => i.replace('.', ''))
            }
          ]
        })

        if (!mountedRef.current) {
          return []
        }

        if (_files) {
          if (!useAllFiles) {
            setFiles((currentFiles) => [...currentFiles, ..._files])
            return _files
          }
          const supportedFiles = await filterSupportedFiles(_files, extensions)

          if (!mountedRef.current) {
            return []
          }

          if (supportedFiles.length > 0) {
            setFiles((currentFiles) => [...currentFiles, ...supportedFiles])
          }

          if (supportedFiles.length !== _files.length) {
            window.toast?.info(
              t('chat.input.file_not_supported_count', {
                count: _files.length - supportedFiles.length
              })
            )
          }
          return supportedFiles
        } else {
          return []
        }
      } finally {
        selectingRef.current = false
        if (mountedRef.current) {
          setSelecting(false)
        }
      }
    },
    [extensions, t]
  )

  const clearFiles = useCallback(() => {
    setFiles([])
  }, [])

  return {
    files,
    selecting,
    setFiles,
    onSelectFile,
    clearFiles
  }
}
