console.error(
  [
    'Local publish is disabled for Cherry Studio Pi.',
    'Use GitHub Actions -> Release -> Run workflow with an explicit tag and matching confirm_tag.',
    'Do not publish releases from a local patch-bump command.'
  ].join('\n')
)
process.exit(1)
