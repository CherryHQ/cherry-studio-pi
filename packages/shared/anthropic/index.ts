/**
 * @fileoverview Shared Anthropic AI client utilities for Cherry Studio
 *
 * This module provides functions for creating Anthropic SDK clients with different
 * authentication methods (OAuth, API key).
 * It supports both standard Anthropic API and Anthropic Vertex AI endpoints.
 *
 * This shared module can be used by both main and renderer processes.
 */

import Anthropic from '@anthropic-ai/sdk'
import { loggerService } from '@logger'
import { withoutTrailingApiVersion } from '@shared/utils/api'
import type { Provider } from '@types'

const logger = loggerService.withContext('anthropic-sdk')

/**
 * Creates and configures an Anthropic SDK client based on the provider configuration.
 *
 * This function supports two authentication methods:
 * 1. OAuth: Uses OAuth tokens passed as parameter
 * 2. API Key: Uses traditional API key authentication
 *
 * For OAuth authentication, it includes Anthropic OAuth headers and beta features.
 * For API key authentication, it uses the provider's configuration with custom headers.
 *
 * @param provider - The provider configuration containing authentication details
 * @param oauthToken - Optional OAuth token for OAuth authentication
 * @returns An initialized Anthropic or AnthropicVertex client
 * @throws Error when OAuth token is not available for OAuth authentication
 *
 * @example
 * ```typescript
 * // OAuth authentication
 * const oauthProvider = { authType: 'oauth' };
 * const oauthClient = getSdkClient(oauthProvider, 'oauth-token-here');
 *
 * // API key authentication
 * const apiKeyProvider = {
 *   authType: 'apikey',
 *   apiKey: 'your-api-key',
 *   apiHost: 'https://api.anthropic.com'
 * };
 * const apiKeyClient = getSdkClient(apiKeyProvider);
 * ```
 */
export function getSdkClient(
  provider: Provider,
  oauthToken?: string | null,
  extraHeaders?: Record<string, string | string[]>
): Anthropic {
  if (provider.authType === 'oauth') {
    if (!oauthToken) {
      throw new Error('OAuth token is not available')
    }
    return new Anthropic({
      authToken: oauthToken,
      baseURL: 'https://api.anthropic.com',
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'anthropic-beta':
          'oauth-2025-04-20,claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
        'anthropic-dangerous-direct-browser-access': 'true',
        'user-agent': 'claude-cli/1.0.118 (external, sdk-ts)',
        'x-app': 'cli',
        'x-stainless-retry-count': '0',
        'x-stainless-timeout': '600',
        'x-stainless-lang': 'js',
        'x-stainless-package-version': '0.60.0',
        'x-stainless-os': 'MacOS',
        'x-stainless-arch': 'arm64',
        'x-stainless-runtime': 'node',
        'x-stainless-runtime-version': 'v22.18.0',
        ...extraHeaders
      }
    })
  }
  const rawBaseURL =
    provider.type === 'anthropic'
      ? provider.apiHost
      : (provider.anthropicApiHost && provider.anthropicApiHost.trim()) || provider.apiHost
  const baseURL = withoutTrailingApiVersion(rawBaseURL)

  logger.debug('Anthropic API baseURL', { baseURL, providerId: provider.id })

  if (provider.id === 'aihubmix') {
    return new Anthropic({
      apiKey: provider.apiKey,
      baseURL,
      dangerouslyAllowBrowser: true,
      defaultHeaders: {
        'anthropic-beta': 'output-128k-2025-02-19',
        'APP-Code': 'MLTG2087',
        ...provider.extra_headers,
        ...extraHeaders
      }
    })
  }

  return new Anthropic({
    apiKey: provider.apiKey,
    authToken: provider.apiKey,
    baseURL,
    dangerouslyAllowBrowser: true,
    defaultHeaders: {
      'anthropic-beta': 'output-128k-2025-02-19',
      ...provider.extra_headers
    }
  })
}
