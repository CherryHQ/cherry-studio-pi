require('dotenv').config()
const fs = require('fs')
const path = require('path')
const { notarize } = require('@electron/notarize')
const { parse } = require('yaml')

function readPackagedAppId(configPath = path.join(__dirname, '..', 'electron-builder.yml')) {
  const config = parse(fs.readFileSync(configPath, 'utf8'))
  if (!config?.appId) {
    throw new Error(`electron-builder appId is missing in ${configPath}`)
  }
  return config.appId
}

exports._internal = {
  readPackagedAppId
}

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') {
    return
  }

  if (!process.env.APPLE_ID || !process.env.APPLE_APP_SPECIFIC_PASSWORD || !process.env.APPLE_TEAM_ID) {
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${context.appOutDir}/${appName}.app`

  await notarize({
    appPath,
    appBundleId: readPackagedAppId(),
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  })

  console.log('  • Notarized app:', appPath)
}
