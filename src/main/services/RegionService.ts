/**
 * Lightweight egress-region helper kept for upstream BinaryManager tests and
 * future mirror selection. Pi currently does not wire this into proxy-change
 * invalidation; callers should treat failures as "not in China".
 */
class RegionService {
  async getCountry(): Promise<string> {
    return 'CN'
  }

  async isInChina(): Promise<boolean> {
    return false
  }
}

export const regionService = new RegionService()
