import type { FC } from 'react'
import { memo, useMemo } from 'react'

interface HighlightTextProps {
  text: string
  keyword: string
  caseSensitive?: boolean
  className?: string
}

/**
 * Text highlighting component that marks keyword matches
 */
const HighlightText: FC<HighlightTextProps> = ({ text, keyword, caseSensitive = false, className }) => {
  const highlightedText = useMemo(() => {
    const normalizedKeyword = keyword.trim()
    if (!normalizedKeyword || !text) {
      return <span>{text}</span>
    }

    // Escape regex special characters
    const escapedKeyword = normalizedKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const flags = caseSensitive ? 'g' : 'gi'
    const regex = new RegExp(`(${escapedKeyword})`, flags)
    const exactMatchRegex = new RegExp(`^${escapedKeyword}$`, caseSensitive ? '' : 'i')

    // Split text by keyword matches
    const parts = text.split(regex)

    return (
      <>
        {parts.map((part, index) => {
          // Check if part matches keyword
          const isMatch = exactMatchRegex.test(part)

          if (isMatch) {
            return <mark key={index}>{part}</mark>
          }
          return <span key={index}>{part}</span>
        })}
      </>
    )
  }, [text, keyword, caseSensitive])

  const combinedClassName = className ? `ant-typography ${className}` : 'ant-typography'

  return <span className={combinedClassName}>{highlightedText}</span>
}

export default memo(HighlightText)
